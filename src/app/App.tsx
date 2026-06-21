import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "motion/react";
import {
  QrCode, Users, Clock, CheckCircle2, LogOut, Shield,
  Calendar, MapPin, Search, Check, X, Scan, Bell,
  Building2, Timer, RefreshCw, FileText, BarChart2,
  UserCheck, UserX, Download, Activity, Wifi, WifiOff,
  Smartphone, Monitor, ArrowRight, ChevronRight,
  AlertTriangle, Eye, RotateCcw, Camera, Zap
} from "lucide-react";
import { api, type ApiAttendanceRow, type ApiLeaveRow, type ApiMe, type ApiPublicLocation, type ApiEmployee, type EmployeeInput, type ApiLocation, type LocationInput, type SalaryComponent, type PayrollRule, type PayrollRun, type Payslip, type ExchangeRate } from "./api";
import { Html5Qrcode } from "html5-qrcode";

// ─── Types ────────────────────────────────────────────────────────────────────

type QRVariant = "static" | "dynamic";

interface AttendanceRecord {
  id: string; employeeId: string; date: string;
  checkIn: string | null; checkOut: string | null;
  status: "hadir" | "terlambat" | "izin" | "cuti" | "tidak_hadir";
  location: string; method: "qr_lokasi" | "terminal" | "manual";
}

interface LeaveRequest {
  id: string; employeeId: string; type: "izin" | "cuti";
  startDate: string; endDate: string; reason: string;
  status: "pending" | "approved" | "rejected";
}

// ─── Konfigurasi tampilan (status & warna departemen) ─────────────────────────
// Data karyawan/kehadiran/cuti diambil 100% dari backend (lihat useBackendData &
// api.ts) — tidak ada lagi data contoh/mock di sini.

const STATUS_CFG = {
  hadir:       { label: "Hadir",       color: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  terlambat:   { label: "Terlambat",   color: "bg-amber-100 text-amber-700 border-amber-200",   dot: "bg-amber-500" },
  izin:        { label: "Izin",        color: "bg-blue-100 text-blue-700 border-blue-200",       dot: "bg-blue-500" },
  cuti:        { label: "Cuti",        color: "bg-purple-100 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  tidak_hadir: { label: "Tidak Hadir", color: "bg-red-100 text-red-700 border-red-200",         dot: "bg-red-500" },
};

const DEPT_COLORS: Record<string, string> = {
  "Teknologi Informasi": "bg-indigo-100 text-indigo-700",
  "Sumber Daya Manusia": "bg-pink-100 text-pink-700",
  "Keuangan":            "bg-amber-100 text-amber-700",
  "Marketing":           "bg-teal-100 text-teal-700",
  "Operasional":         "bg-orange-100 text-orange-700",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d: Date) { return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
function fmtDate(d: Date) { return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
function nowHHMM() { const d = new Date(); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

// Status koneksi perangkat (ada internet atau tidak), reaktif.
function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

function useDynamicQR(intervalSec: number) {
  const tick = useCallback(() => Math.floor(Date.now() / (intervalSec * 1000)), [intervalSec]);
  const [window, setWindow] = useState(tick());
  const [timeLeft, setTimeLeft] = useState(() => intervalSec - (Math.floor(Date.now() / 1000) % intervalSec));
  useEffect(() => {
    const t = setInterval(() => {
      const secs = Math.floor(Date.now() / 1000);
      setTimeLeft(intervalSec - (secs % intervalSec));
      const nw = Math.floor(Date.now() / (intervalSec * 1000));
      setWindow(nw);
    }, 1000);
    return () => clearInterval(t);
  }, [intervalSec, tick]);
  const qrData = `ABSENSI-NUSANTARA-JKT-${window}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrData)}&color=1B3D72&bgcolor=FFFFFF&margin=10&format=svg`;
  const staticUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=ABSENSI-NUSANTARA-JKT-STATIC&color=1B3D72&bgcolor=FFFFFF&margin=10&format=svg`;
  return { timeLeft, qrUrl, staticUrl, window };
}

// ─── 2-port sync (DIGANTIKAN backend) ─────────────────────────────────────────
// CATATAN: sejak frontend tersambung ke REST API Zylora (lihat useBackendData),
// sinkronisasi antar-port lewat relay SSE ini TIDAK lagi dipakai — backend yang
// jadi sumber kebenaran + polling. Kode di bawah dibiarkan utuh sebagai referensi
// mode relay lama (server/sync-server.mjs); APP_ROLE masih dipakai untuk deteksi
// dua-port di tab navigasi.
//
// (Lama) When VITE_ROLE is set, the app runs as one of two REAL servers (employee
// :5173, admin :5174). They are separate origins, so shared state is bridged
// through the SSE relay in server/sync-server.mjs instead of React state.
const APP_ROLE = (import.meta.env.VITE_ROLE || "") as "employee" | "control" | "display" | "";

// ─── Shared UI ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AttendanceRecord["status"] }) {
  const c = STATUS_CFG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />{c.label}
    </span>
  );
}

function Avatar({ initials, size = "md" }: { initials: string; size?: "sm" | "md" | "lg" }) {
  const sz = size === "sm" ? "w-8 h-8 text-xs" : size === "lg" ? "w-14 h-14 text-lg" : "w-10 h-10 text-sm";
  return <div className={`${sz} rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center flex-shrink-0`}>{initials}</div>;
}

function MethodBadge({ method }: { method: AttendanceRecord["method"] }) {
  if (method === "qr_lokasi") return <span className="inline-flex items-center gap-1 text-[10px] text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full font-semibold"><QrCode className="w-2.5 h-2.5" />QR Lokasi</span>;
  if (method === "terminal") return <span className="inline-flex items-center gap-1 text-[10px] text-sky-600 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full font-semibold"><Monitor className="w-2.5 h-2.5" />Terminal</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-semibold">Manual</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL 1 — QR Lokasi
// Port :5173 = Employee's phone app — scans the location QR
// Port :5174 = Admin — shows the location QR + dashboard
// ═══════════════════════════════════════════════════════════════════════════════

// App karyawan — MANDIRI: login sebagai karyawan (JWT peran 'employee'), bukan
// GPS perangkat sungguhan (untuk validasi radius di backend). Menolak bila izin
// lokasi ditolak / GPS mati.
function getDeviceGps(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) { reject(new Error("Perangkat tidak mendukung GPS")); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? "Izin lokasi ditolak — aktifkan GPS untuk absen" : "Gagal membaca GPS")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

// Scanner QR kamera SUNGGUHAN (html5-qrcode + getUserMedia). Responsif: qrbox
// menyesuaikan ukuran layar (HP & tablet). Memanggil onDecoded dengan isi QR
// (token lokasi) lalu berhenti.
function QrScanner({ onDecoded, onError }: { onDecoded: (text: string) => void; onError: (msg: string) => void }) {
  const holderId = "zylora-qr-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const doneRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const h = new Html5Qrcode(holderId, { verbose: false } as any);
    scannerRef.current = h;
    h.start(
      { facingMode: "environment" },
      {
        fps: 10,
        qrbox: (vw: number, vh: number) => { const s = Math.floor(Math.min(vw, vh) * 0.7); return { width: s, height: s }; },
      },
      (decoded: string) => {
        if (doneRef.current) return;
        doneRef.current = true;
        h.stop().catch(() => {}).finally(() => { if (!cancelled) onDecoded(decoded); });
      },
      () => { /* gagal decode per-frame: abaikan */ },
    ).catch((e: any) => {
      onError(e?.message?.includes("Permission") || e?.name === "NotAllowedError"
        ? "Izin kamera ditolak — aktifkan kamera untuk memindai QR"
        : (e?.message || "Kamera tidak bisa dibuka"));
    });
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) { try { s.stop().then(() => s.clear()).catch(() => {}); } catch { /* noop */ } }
    };
  }, [onDecoded, onError]);
  return <div id={holderId} className="w-full h-full [&_video]:w-full [&_video]:h-full [&_video]:object-cover" />;
}

// Banner update OTA (self-host EC2): bandingkan versionCode build (di-bake) dengan
// manifest /downloads/version.json; bila ada versi lebih baru → tawarkan unduh APK.
// Banner merah saat perangkat tak ada internet — absensi & data tak tersinkron.
function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className="bg-red-600 text-white px-4 py-2 flex items-center justify-center gap-2 text-sm flex-shrink-0">
      <WifiOff className="w-4 h-4 flex-shrink-0" />Tidak ada internet — absensi tak bisa dikirim
    </div>
  );
}

function UpdateBanner({ role }: { role: string }) {
  const [upd, setUpd] = useState<{ versionName?: string; url: string } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const myVc = Number((import.meta as any).env?.VITE_VERSION_CODE || 0);
    api.appManifest().then((m) => {
      const rel = m?.[role];
      if (rel && Number(rel.versionCode) > myVc) setUpd({ versionName: rel.versionName, url: rel.url });
    }).catch(() => {});
  }, [role]);
  if (!upd || dismissed) return null;
  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center justify-between gap-2 text-sm flex-shrink-0">
      <span className="flex items-center gap-2"><Download className="w-4 h-4 flex-shrink-0" />Pembaruan tersedia{upd.versionName ? ` (v${upd.versionName})` : ""}</span>
      <span className="flex items-center gap-3">
        <a href={upd.url} className="font-bold underline whitespace-nowrap">Unduh</a>
        <button onClick={() => setDismissed(true)} className="opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
      </span>
    </div>
  );
}

// App karyawan — MANDIRI: login sebagai karyawan (JWT peran 'employee'), bukan
// admin. Status & check-in lewat /api/me/*; identitas dari token (tak kirim kode).
function QRLokasiEmployeeApp() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<ApiMe | null>(null);
  const [loginId, setLoginId] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const [scanFor, setScanFor] = useState<null | "in" | "out">(null);
  const scanForRef = useRef<null | "in" | "out">(null);
  const [locName, setLocName] = useState("Lokasi Kantor");
  const now = useClock();

  const loggedIn = !!token && !!me;
  const checkedIn = !!me?.today?.check_in;
  const checkedOut = !!me?.today?.check_out;

  // Bentuk objek 'employee' yang dipakai JSX (avatar = inisial nama).
  const employee = me ? {
    id: me.employeeId, name: me.name, position: me.position,
    scheduleIn: me.schedule.in, scheduleOut: me.schedule.out,
    avatar: me.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase(),
  } : null;
  const rec = me?.today
    ? { checkIn: me.today.check_in, status: me.today.status as AttendanceRecord["status"] }
    : undefined;

  const doLogin = async () => {
    setBusy(true); setLoginErr("");
    try {
      const r = await api.employeeLogin(loginId.trim(), loginPin.trim());
      setToken(r.token);
      setMe(await api.me(r.token));
      try { setLocName((await api.publicLocation()).name); } catch { /* abaikan */ }
    } catch (e: any) {
      setLoginErr(e?.message || "Login gagal");
    } finally { setBusy(false); }
  };

  const doLogout = async () => {
    if (token) { try { await api.employeeLogout(token); } catch { /* abaikan */ } }
    setToken(null); setMe(null); setLoginId(""); setLoginPin("");
  };

  // Buka kamera untuk memindai QR lokasi (action disimpan di ref agar callback
  // scanner stabil & kamera tak restart tiap render).
  const openScan = (action: "in" | "out") => { scanForRef.current = action; setScanErr(""); setScanFor(action); };
  const cancelScan = () => { setScanFor(null); };

  // Dipanggil saat QR berhasil dibaca: ambil GPS asli lalu kirim ke backend.
  const handleDecoded = useCallback(async (scannedToken: string) => {
    const action = scanForRef.current;
    if (!token || !action) return;
    setScanFor(null); setScanning(true); setScanErr("");
    try {
      const gps = await getDeviceGps();
      if (action === "in") await api.meCheckin(token, { location_token: scannedToken, lat: gps.lat, lng: gps.lng });
      else await api.meCheckout(token, { location_token: scannedToken, lat: gps.lat, lng: gps.lng });
      setMe(await api.me(token));
      setScanDone(true);
      setTimeout(() => setScanDone(false), 2500);
    } catch (e: any) {
      setScanErr(e?.message || "Gagal absen");
    } finally {
      setScanning(false);
    }
  }, [token]);

  const handleScanErr = useCallback((msg: string) => { setScanFor(null); setScanErr(msg); }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      <OfflineBanner />
      <UpdateBanner role="employee" />
      {/* Header */}
      <div className="bg-[#1B3D72] px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Smartphone className="w-5 h-5 text-white/80" />
          <div>
            <p className="font-bold text-white text-sm">Zylora Absensi</p>
            <p className="text-[10px] text-white/50">Absensi QR Karyawan</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold text-white tabular-nums">{fmtTime(now)}</p>
          <p className="text-[10px] text-white/60">{fmtDate(now)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!loggedIn ? (
          /* Login */
          <div className="flex items-center justify-center min-h-full py-8">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-2xl border border-border p-7 w-full max-w-sm shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-5">
                <Smartphone className="w-6 h-6 text-white" />
              </div>
              <h2 className="font-bold text-lg mb-1">Masuk ke Aplikasi</h2>
              <p className="text-sm text-muted-foreground mb-5">Gunakan ID karyawan Anda untuk login, lalu pindai QR yang ditempel di lokasi absen.</p>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">ID atau Email</label>
              <input value={loginId} onChange={e => setLoginId(e.target.value)}
                placeholder="ID atau email dari admin"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-input-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-3 transition-all" />
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">PIN</label>
              <input value={loginPin} onChange={e => setLoginPin(e.target.value)} type="password"
                onKeyDown={e => e.key === "Enter" && doLogin()}
                placeholder="••••••"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-input-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-1 transition-all" />
              {loginErr && <p className="text-xs text-destructive mb-2">{loginErr}</p>}
              <p className="text-[11px] text-muted-foreground mt-2">ID &amp; PIN dibuat oleh admin di Sistem Kontrol → Karyawan.</p>
              <button onClick={doLogin} disabled={!loginId.trim() || !loginPin.trim() || busy}
                className="w-full mt-3 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                {busy ? "Memproses…" : <>Masuk <ArrowRight className="w-4 h-4" /></>}
              </button>
            </motion.div>
          </div>
        ) : employee ? (
          <div className="space-y-4 max-w-md md:max-w-lg mx-auto w-full">
            {/* User bar */}
            <div className="bg-card rounded-xl border border-border px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Avatar initials={employee.avatar} />
                <div>
                  <p className="font-bold text-sm">{employee.name}</p>
                  <p className="text-xs text-muted-foreground">{employee.position}</p>
                </div>
              </div>
              <button onClick={doLogout}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                <LogOut className="w-3.5 h-3.5" />Keluar
              </button>
            </div>

            {/* Status */}
            <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${checkedIn ? "bg-emerald-100" : "bg-muted"}`}>
                {checkedIn ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Clock className="w-5 h-5 text-muted-foreground" />}
              </div>
              <div>
                <p className="font-semibold text-sm">
                  {checkedOut ? "Absen selesai hari ini" : checkedIn ? `Check-in tercatat: ${rec?.checkIn}` : "Belum check-in"}
                </p>
                <p className="text-xs text-muted-foreground">Jadwal: {employee.scheduleIn} – {employee.scheduleOut}</p>
              </div>
              {rec && <div className="ml-auto"><StatusBadge status={rec.status} /></div>}
            </div>

            {/* Scanner Panel */}
            <div className="bg-card rounded-2xl border border-border p-5">
              <p className="text-sm font-semibold mb-1">Pindai QR di Lokasi Absen</p>
              <p className="text-xs text-muted-foreground mb-4">Arahkan kamera ponsel ke QR Code yang ditampilkan di layar / ditempel di area pintu masuk.</p>

              {/* Viewfinder — kamera SUNGGUHAN saat memindai (responsif HP & tablet) */}
              <div className="relative w-full max-w-[240px] sm:max-w-[320px] md:max-w-[380px] mx-auto aspect-square bg-foreground/5 rounded-2xl border-2 border-dashed border-border overflow-hidden flex items-center justify-center mb-3">
                {scanDone ? (
                  <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-16 h-16 text-accent" />
                    <p className="text-sm font-bold text-accent">{checkedIn && !checkedOut ? "Check-Out Berhasil" : "Check-In Berhasil"}</p>
                  </motion.div>
                ) : scanFor ? (
                  <QrScanner onDecoded={handleDecoded} onError={handleScanErr} />
                ) : scanning ? (
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                      <Camera className="w-10 h-10" />
                    </motion.div>
                    <p className="text-xs font-semibold">Memproses & cek GPS…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Camera className="w-10 h-10 opacity-30" />
                    <p className="text-xs text-center opacity-60">Tekan tombol di bawah untuk<br/>membuka kamera &amp; pindai QR</p>
                  </div>
                )}

                {/* Corner marks (disembunyikan saat kamera live) */}
                {!scanFor && ["top-2 left-2", "top-2 right-2", "bottom-2 left-2", "bottom-2 right-2"].map((p, i) => (
                  <div key={i} className={`absolute ${p} w-5 h-5 border-primary/50 border-2 ${i===0?"rounded-tl border-r-0 border-b-0":i===1?"rounded-tr border-l-0 border-b-0":i===2?"rounded-bl border-r-0 border-t-0":"rounded-br border-l-0 border-t-0"}`} />
                ))}
              </div>

              {scanFor && (
                <button onClick={cancelScan} className="w-full mb-3 py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/40">Batal</button>
              )}

              {/* GPS — koordinat HP diperiksa saat absen (validasi radius di server) */}
              <div className="flex items-center justify-center gap-2 text-xs font-semibold mb-4 text-muted-foreground text-center">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Lokasi: {locName} · GPS HP diperiksa saat memindai</span>
              </div>

              {scanErr && (
                <div className="flex items-start gap-2 p-2.5 mb-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{scanErr}
                </div>
              )}

              {/* Buttons */}
              {!scanFor && !checkedIn && !checkedOut && (
                <button onClick={() => openScan("in")} disabled={scanning}
                  className="w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  <Camera className="w-4 h-4" />Pindai untuk Check-In
                </button>
              )}
              {!scanFor && checkedIn && !checkedOut && (
                <button onClick={() => openScan("out")} disabled={scanning}
                  className="w-full py-3 rounded-xl bg-foreground text-background font-semibold text-sm hover:bg-foreground/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  <LogOut className="w-4 h-4" />Pindai untuk Check-Out
                </button>
              )}
              {checkedOut && (
                <div className="w-full py-3 rounded-xl bg-muted text-muted-foreground font-semibold text-sm flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />Absen selesai
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// Login admin Sistem Kontrol (mengganti auto-login demo). Bisa juga daftar
// perusahaan+admin baru (POST /api/control/register) untuk setup awal.
function ControlLogin({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!email.trim() || !password) { setErr("Email & password wajib"); return; }
    if (mode === "register" && (!name.trim() || !company.trim())) { setErr("Nama admin & perusahaan wajib"); return; }
    if (mode === "register" && password.length < 8) { setErr("Password minimal 8 karakter"); return; }
    setBusy(true); setErr("");
    try {
      if (mode === "register") await api.controlRegister({ name: name.trim(), email: email.trim(), password, company_name: company.trim() });
      await onLogin(email, password);
    } catch (e: any) { setErr(e?.message || "Gagal masuk"); setBusy(false); }
  };
  const inputCls = "w-full px-3 py-2 rounded-lg border border-border text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <div className="h-screen flex items-center justify-center bg-[#0D1B2A] p-4" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="bg-card rounded-2xl border border-border p-7 w-full max-w-sm shadow-lg">
        <div className="w-12 h-12 rounded-xl bg-[#1B3D72] flex items-center justify-center mb-5"><Shield className="w-6 h-6 text-white" /></div>
        <h2 className="font-bold text-lg mb-1">{mode === "login" ? "Masuk Sistem Kontrol" : "Daftar Perusahaan"}</h2>
        <p className="text-sm text-muted-foreground mb-5">{mode === "login" ? "Login admin untuk mengelola absensi." : "Buat akun admin + perusahaan baru."}</p>
        {err && <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{err}</div>}
        {mode === "register" && <>
          <input className={inputCls} placeholder="Nama admin" value={name} onChange={e => setName(e.target.value)} />
          <input className={inputCls} placeholder="Nama perusahaan (PT ...)" value={company} onChange={e => setCompany(e.target.value)} />
        </>}
        <input className={inputCls} type="email" placeholder="Email admin" value={email} onChange={e => setEmail(e.target.value)} />
        <input className={inputCls} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        <button disabled={busy} onClick={submit} className="w-full mt-1 py-3 rounded-xl bg-[#1B3D72] text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50">{busy ? "Memproses…" : mode === "login" ? "Masuk" : "Daftar & Masuk"}</button>
        <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setErr(""); }} className="w-full mt-3 text-xs text-muted-foreground hover:text-foreground">
          {mode === "login" ? "Belum punya akun? Daftar perusahaan baru" : "Sudah punya akun? Masuk"}
        </button>
      </div>
    </div>
  );
}

function QRLokasiControlPanel({ attendance, leaveRequests, onApproveLeave, onRejectLeave, employees, onCreateEmployee, onUpdateEmployee, onDeleteEmployee, onResetCode, authed, onLogin, onLogout, token, connected, locations, onCreateLocation, onCreateLocationQr, qrVariant, setQrVariant, qrInterval, setQrInterval }: {
  attendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  onApproveLeave: (id: string) => void;
  onRejectLeave: (id: string) => void;
  employees: ApiEmployee[];
  onCreateEmployee: (b: EmployeeInput) => Promise<void>;
  onUpdateEmployee: (id: string, b: EmployeeInput) => Promise<void>;
  onDeleteEmployee: (id: string, soft?: boolean) => Promise<void>;
  onResetCode: (id: string) => Promise<void>;
  authed: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
  onLogout: () => void;
  token: string | null;
  connected: boolean;
  locations: ApiLocation[];
  onCreateLocation: (b: LocationInput) => Promise<void>;
  onCreateLocationQr: (locationId: string, interval?: "hourly" | "daily") => Promise<{ qrImageUrl: string }>;
  qrVariant: QRVariant; setQrVariant: (v: QRVariant) => void;
  qrInterval: number; setQrInterval: (n: number) => void;
}) {
  const now = useClock();
  const online = useOnline();
  const empName = useCallback((id: string) => employees.find(e => e.employeeId === id), [employees]);
  const initials = (name: string) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const { timeLeft, qrUrl, staticUrl } = useDynamicQR(qrInterval);
  const [tab, setTab] = useState<"qr_display" | "kehadiran" | "izin_cuti" | "karyawan" | "lokasi" | "shift" | "perangkat" | "riwayat" | "penggajian" | "kurs" | "pengaturan" | "log">("qr_display");
  // Data ASLI dari server untuk pratinjau QR (bukan hardcoded/client-side).
  const [companyName, setCompanyName] = useState("");
  const [pubLoc, setPubLoc] = useState<ApiPublicLocation | null>(null);
  useEffect(() => {
    if (!authed || !token) return;
    let alive = true;
    const tick = () => {
      api.company(token).then(c => alive && setCompanyName(c.name)).catch(() => {});
      api.publicLocation().then(p => alive && setPubLoc(p)).catch(() => alive && setPubLoc(null));
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [authed, token]);

  // Belum login → layar login admin (ganti auto-login demo). Setelah semua hooks
  // agar tidak melanggar rules-of-hooks.
  if (!authed) return <ControlLogin onLogin={onLogin} />;

  const stats = {
    hadir: attendance.filter(a => a.status === "hadir").length,
    terlambat: attendance.filter(a => a.status === "terlambat").length,
    izin: attendance.filter(a => a.status === "izin" || a.status === "cuti").length,
    tidakHadir: attendance.filter(a => a.status === "tidak_hadir").length,
  };

  const approve = onApproveLeave;
  const reject = onRejectLeave;

  const pct = Math.round((timeLeft / qrInterval) * 100);
  const circum = 2 * Math.PI * 22;
  const dash = (pct / 100) * circum;

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-52 bg-[#1B3D72] flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-white/70" />
            <div>
              <p className="font-bold text-white text-sm">Sistem Kontrol</p>
              <p className="text-[10px] text-white/40">Panel Admin · Desktop</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {[
            { key: "qr_display", label: "Tampilan QR", icon: <QrCode className="w-4 h-4" /> },
            { key: "kehadiran",  label: "Kehadiran",   icon: <Activity className="w-4 h-4" /> },
            { key: "izin_cuti",  label: "Izin & Cuti", icon: <FileText className="w-4 h-4" />, badge: leaveRequests.filter(l => l.status === "pending").length },
            { key: "karyawan",   label: "Karyawan",    icon: <UserCheck className="w-4 h-4" />, badge: employees.length },
            { key: "lokasi",     label: "Lokasi & QR", icon: <MapPin className="w-4 h-4" />, badge: locations.length },
            { key: "shift",      label: "Shift",       icon: <Timer className="w-4 h-4" /> },
            { key: "perangkat",  label: "Perangkat",   icon: <Smartphone className="w-4 h-4" /> },
            { key: "riwayat",    label: "Riwayat",     icon: <Calendar className="w-4 h-4" /> },
            { key: "penggajian", label: "Penggajian",  icon: <Download className="w-4 h-4" /> },
            { key: "kurs",       label: "Kurs",        icon: <RotateCcw className="w-4 h-4" /> },
            { key: "pengaturan", label: "Pengaturan",  icon: <Building2 className="w-4 h-4" /> },
            { key: "log",        label: "Log Audit",   icon: <BarChart2 className="w-4 h-4" /> },
          ].map(({ key, label, icon, badge }: any) => (
            <button key={key} onClick={() => setTab(key)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === key ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}>
              <span className="flex items-center gap-2">{icon}{label}</span>
              {badge ? <span className="bg-amber-400 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-white/10">
          <div className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-accent" : online ? "text-amber-400" : "text-red-400"}`}>
            {connected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            {connected ? "Terhubung ke server" : online ? "Server tak terjangkau" : "Tidak ada internet"}
          </div>
          <p className="font-mono text-white/70 text-xs mt-0.5 mb-2 tabular-nums">{fmtTime(now)}</p>
          <button onClick={onLogout} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 bg-white/10 hover:bg-white/20 transition-colors">
            <LogOut className="w-3.5 h-3.5" />Keluar
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="bg-card border-b border-border px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="font-bold text-sm">
              {({ qr_display: "QR Code Lokasi Absensi", kehadiran: "Rekap Kehadiran", izin_cuti: "Manajemen Izin & Cuti", karyawan: "Kelola Karyawan", lokasi: "Lokasi & QR", shift: "Shift Kerja", perangkat: "Perangkat Terdaftar", riwayat: "Riwayat Presensi", penggajian: "Penggajian", kurs: "Manajemen Kurs", pengaturan: "Pengaturan Perusahaan", log: "Log Audit" } as Record<string, string>)[tab]}
            </h1>
            <p className="text-xs text-muted-foreground">{fmtDate(now)}</p>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">

          {/* QR Display Tab */}
          {tab === "qr_display" && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Settings */}
              <div className="bg-card rounded-xl border border-border p-5 space-y-4">
                <p className="font-semibold text-sm">Pengaturan QR Lokasi</p>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Jenis Kode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { v: "static", label: "Statis", desc: "Permanen, cetak sekali", icon: <QrCode className="w-4 h-4" /> },
                      { v: "dynamic", label: "Dinamis", desc: "Berubah berkala, lebih aman", icon: <Zap className="w-4 h-4" /> },
                    ].map(({ v, label, desc, icon }) => (
                      <button key={v} onClick={() => setQrVariant(v as QRVariant)}
                        className={`flex flex-col items-start p-3 rounded-xl border-2 text-left transition-all ${qrVariant === v ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}>
                        <span className={`mb-1 ${qrVariant === v ? "text-primary" : "text-muted-foreground"}`}>{icon}</span>
                        <span className="font-semibold text-xs">{label}</span>
                        <span className="text-[10px] text-muted-foreground">{desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {qrVariant === "dynamic" && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Interval Pergantian</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { v: 60, label: "1 Menit" },
                        { v: 300, label: "5 Menit" },
                        { v: 3600, label: "1 Jam" },
                      ].map(({ v, label }) => (
                        <button key={v} onClick={() => setQrInterval(v)}
                          className={`py-2 rounded-lg border text-xs font-semibold transition-all ${qrInterval === v ? "bg-primary text-white border-primary" : "border-border hover:border-primary/40"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {qrVariant === "static" && (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">Kode statis berisiko disalahgunakan jika difoto dan digunakan dari luar lokasi. Pertimbangkan QR dinamis + verifikasi GPS.</p>
                  </div>
                )}

                {qrVariant === "dynamic" && (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-700">Kode dinamis lebih aman karena hanya valid selama interval yang ditentukan. Disarankan untuk ditampilkan di layar monitor pintu masuk.</p>
                  </div>
                )}
              </div>

              {/* QR Preview — "what's shown at entrance" */}
              <div className="bg-card rounded-xl border border-border p-5 flex flex-col items-center gap-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground self-start">
                  <Monitor className="w-3.5 h-3.5" />
                  <span>Pratinjau tampilan di pintu masuk</span>
                </div>

                <div className="bg-[#1B3D72] rounded-2xl p-5 w-full flex flex-col items-center gap-3">
                  <p className="text-white/80 text-xs font-semibold uppercase tracking-widest">{companyName || "—"}</p>
                  <p className="text-white font-bold text-sm">{pubLoc?.name || "Belum ada lokasi/QR aktif"}</p>

                  {pubLoc?.qrImageUrl ? (
                    <div className="relative bg-white rounded-xl p-3 shadow-lg">
                      <img src={pubLoc.qrImageUrl} alt="QR Lokasi" width={160} height={160} className="block rounded-sm" />
                      {pubLoc.type === "qr_dynamic" && (
                        <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center"><Zap className="w-3 h-3 text-white" /></div>
                      )}
                    </div>
                  ) : (
                    <div className="w-[160px] h-[160px] bg-white/10 rounded-xl flex items-center justify-center text-white/40 text-[11px] text-center p-4">Buat QR dulu di tab<br/>"Lokasi & QR"</div>
                  )}

                  {pubLoc?.type === "qr_dynamic" && pubLoc.serial != null ? (
                    <p className="text-white text-xs font-semibold">Nomor Seri #{pubLoc.serial} · sekali pakai</p>
                  ) : pubLoc?.type === "qr_static" ? (
                    <p className="text-white/50 text-xs">Kode Statis — tetap</p>
                  ) : null}

                  <p className="text-white/40 text-[10px] font-mono">Sinkron langsung dari server · pindai dgn app karyawan</p>
                </div>
              </div>
            </div>
          )}

          {/* Attendance Tab */}
          {tab === "kehadiran" && (
            <>
              <div className="grid grid-cols-4 gap-3">
                {[
                  { label: "Hadir", v: stats.hadir, color: "text-emerald-600 bg-emerald-50 border-emerald-100", icon: <UserCheck className="w-4 h-4" /> },
                  { label: "Terlambat", v: stats.terlambat, color: "text-amber-600 bg-amber-50 border-amber-100", icon: <Timer className="w-4 h-4" /> },
                  { label: "Izin/Cuti", v: stats.izin, color: "text-blue-600 bg-blue-50 border-blue-100", icon: <FileText className="w-4 h-4" /> },
                  { label: "Tidak Hadir", v: stats.tidakHadir, color: "text-red-600 bg-red-50 border-red-100", icon: <UserX className="w-4 h-4" /> },
                ].map(({ label, v, color, icon }) => (
                  <div key={label} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center border ${color}`}>{icon}</div>
                    <div><p className="text-xl font-bold tabular-nums">{v}</p><p className="text-xs text-muted-foreground">{label}</p></div>
                  </div>
                ))}
              </div>
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border bg-muted/30">
                    {["Karyawan", "Check-In", "Check-Out", "Status", "Metode"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {attendance.map(rec => {
                      const emp = empName(rec.employeeId);
                      const nm = emp?.name ?? rec.employeeId;
                      const dept = emp?.department ?? "—";
                      return (
                        <tr key={rec.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Avatar initials={initials(nm)} size="sm" />
                              <div>
                                <p className="font-semibold text-sm">{nm}</p>
                                <p className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${DEPT_COLORS[dept] ?? "bg-muted text-foreground"} inline-block`}>{dept}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-2.5"><span className={`font-mono text-sm ${rec.checkIn ? "font-semibold" : "text-muted-foreground"}`}>{rec.checkIn ?? "—"}</span></td>
                          <td className="px-4 py-2.5"><span className={`font-mono text-sm ${rec.checkOut ? "font-semibold" : "text-muted-foreground"}`}>{rec.checkOut ?? "—"}</span></td>
                          <td className="px-4 py-2.5"><StatusBadge status={rec.status} /></td>
                          <td className="px-4 py-2.5"><MethodBadge method={rec.method} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Leave Tab */}
          {tab === "izin_cuti" && (
            <div className="space-y-3">
              {leaveRequests.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-8">Belum ada pengajuan izin/cuti.</p>
              )}
              {leaveRequests.map(req => {
                const emp = empName(req.employeeId);
                const nm = emp?.name ?? req.employeeId;
                return (
                  <div key={req.id} className="bg-card rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <Avatar initials={initials(nm)} />
                        <div>
                          <p className="font-bold text-sm">{nm}</p>
                          <p className="text-xs text-muted-foreground">{emp?.position ?? "—"}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${req.type === "cuti" ? "bg-purple-100 text-purple-700 border-purple-200" : "bg-blue-100 text-blue-700 border-blue-200"}`}>{req.type === "cuti" ? "Cuti" : "Izin"}</span>
                            <span className="text-xs text-muted-foreground font-mono">{req.startDate === req.endDate ? req.startDate : `${req.startDate} – ${req.endDate}`}</span>
                          </div>
                          <p className="text-sm mt-1.5 italic text-muted-foreground">&ldquo;{req.reason}&rdquo;</p>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        {req.status === "pending" ? (
                          <div className="flex gap-2">
                            <button onClick={() => approve(req.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition-colors"><Check className="w-3.5 h-3.5" />Setujui</button>
                            <button onClick={() => reject(req.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-semibold hover:bg-red-100 transition-colors"><X className="w-3.5 h-3.5" />Tolak</button>
                          </div>
                        ) : (
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${req.status === "approved" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}`}>{req.status === "approved" ? "Disetujui" : "Ditolak"}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Karyawan Tab */}
          {tab === "karyawan" && (
            <EmployeeManagerTab employees={employees} onCreate={onCreateEmployee}
              onUpdate={onUpdateEmployee} onDelete={onDeleteEmployee} onResetCode={onResetCode} />
          )}

          {/* Lokasi Tab */}
          {tab === "lokasi" && (
            <LokasiTab token={token!} locations={locations} onCreate={onCreateLocation} onCreateQr={onCreateLocationQr} />
          )}

          {tab === "shift" && <ShiftTab token={token!} />}
          {tab === "perangkat" && <DeviceTab token={token!} employees={employees} />}
          {tab === "riwayat" && <RiwayatTab token={token!} employees={employees} />}
          {tab === "penggajian" && <PayrollTab token={token!} />}
          {tab === "kurs" && <KursTab token={token!} />}
          {tab === "pengaturan" && <PengaturanTab token={token!} />}
          {tab === "log" && <LogTab token={token!} />}
        </div>
      </div>
    </div>
  );
}

// Modul Kelola Karyawan (admin) — CRUD penuh ke backend (/api/employees*).
function EmployeeManagerTab({ employees, onCreate, onUpdate, onDelete, onResetCode }: {
  employees: ApiEmployee[];
  onCreate: (b: EmployeeInput) => Promise<void>;
  onUpdate: (id: string, b: EmployeeInput) => Promise<void>;
  onDelete: (id: string, soft?: boolean) => Promise<void>;
  onResetCode: (id: string) => Promise<void>;
}) {
  const EMPTY: EmployeeInput = { name: "", email: "", position: "", department: "", schedule_in: "08:00", schedule_out: "17:00", password: "", base_salary: 0 };
  const [mode, setMode] = useState<"list" | "form">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EmployeeInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const openAdd = () => { setEditId(null); setForm(EMPTY); setErr(""); setMode("form"); };
  const openEdit = (e: ApiEmployee) => {
    setEditId(e.employeeId);
    setForm({ name: e.name, email: e.email ?? "", position: e.position ?? "", department: e.department ?? "",
      schedule_in: e.schedule.in ?? "08:00", schedule_out: e.schedule.out ?? "17:00", status: e.status, password: "", base_salary: e.base_salary ?? 0 });
    setErr(""); setMode("form");
  };
  const save = async () => {
    if (!form.name?.trim()) { setErr("Nama wajib diisi"); return; }
    setBusy(true); setErr("");
    try {
      if (editId) await onUpdate(editId, form); else await onCreate(form);
      setMode("list");
    } catch (e: any) { setErr(e?.message || "Gagal menyimpan"); }
    finally { setBusy(false); }
  };
  const doDelete = async (id: string) => {
    setBusy(true); setErr("");
    try { await onDelete(id, false); setConfirmId(null); }
    catch (e: any) { setErr(e?.message || "Gagal menghapus"); }
    finally { setBusy(false); }
  };
  const doReset = async (id: string) => {
    setBusy(true); setErr("");
    try { await onResetCode(id); } catch (e: any) { setErr(e?.message || "Gagal reset kode"); }
    finally { setBusy(false); }
  };

  const field = (label: string, key: keyof EmployeeInput, type = "text", placeholder = "") => (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">{label}</label>
      <input type={type} value={(form[key] as string) ?? ""} placeholder={placeholder}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
    </div>
  );

  if (mode === "form") return (
    <div className="bg-card rounded-xl border border-border p-5 max-w-2xl space-y-4">
      <p className="font-semibold text-sm">{editId ? "Edit Karyawan" : "Tambah Karyawan"}</p>
      {err && <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="grid grid-cols-2 gap-3">
        {field("Nama", "name", "text", "Nama lengkap")}
        {field("Email", "email", "email", "nama@perusahaan.co.id")}
        {field("Posisi", "position", "text", "mis. Staff IT")}
        {field("Departemen", "department", "text", "mis. Teknologi Informasi")}
        {field("Jam Masuk", "schedule_in", "time")}
        {field("Jam Keluar", "schedule_out", "time")}
      </div>
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Gaji Pokok (Rp)</label>
        <input type="number" value={form.base_salary ?? 0} placeholder="mis. 5000000"
          onChange={e => setForm(f => ({ ...f, base_salary: Number(e.target.value) || 0 }))}
          className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
      </div>
      <div>
        <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">PIN / Password Login Karyawan</label>
        <input type="text" value={form.password ?? ""} placeholder={editId ? "Kosongkan jika tidak diubah" : "mis. 123456 — untuk login app karyawan"}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
          className="w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
        <p className="text-[11px] text-muted-foreground mt-1">{editId ? "Isi untuk mengganti PIN karyawan." : "Tanpa PIN, karyawan tidak bisa login di app & absen."}</p>
      </div>
      {editId && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Status</label>
          <select value={form.status ?? "active"} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
            className="w-full px-3 py-2 rounded-lg border border-border text-sm">
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
          </select>
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <button disabled={busy} onClick={save} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"><Check className="w-4 h-4" />{busy ? "Menyimpan…" : "Simpan"}</button>
        <button disabled={busy} onClick={() => setMode("list")} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted/40">Batal</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{employees.length} karyawan terdaftar</p>
        <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90"><UserCheck className="w-4 h-4" />Tambah Karyawan</button>
      </div>
      {err && <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border bg-muted/30">
            {["Karyawan", "Departemen", "Jadwal", "Status", "QR / PIN", "Aksi"].map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {employees.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">Belum ada karyawan. Klik "Tambah Karyawan".</td></tr>
            )}
            {employees.map(e => (
              <tr key={e.employeeId} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Avatar initials={e.name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()} size="sm" />
                    <div>
                      <p className="font-semibold text-sm">{e.name}</p>
                      <p className="text-[11px] text-muted-foreground">{e.position || "—"} · <span className="font-mono">{e.employeeId}</span></p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-2.5"><span className="text-xs">{e.department || "—"}</span></td>
                <td className="px-4 py-2.5"><span className="font-mono text-xs">{e.schedule.in ?? "—"}–{e.schedule.out ?? "—"}</span></td>
                <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${e.status === "active" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>{e.status === "active" ? "Aktif" : "Nonaktif"}</span></td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] block ${e.barcode ? "text-emerald-600" : "text-muted-foreground"}`}>QR {e.barcode ? "✓" : "—"}</span>
                  <span className={`text-[11px] block ${e.has_pin ? "text-emerald-600" : "text-amber-600"}`}>PIN {e.has_pin ? "✓" : "✗"}</span>
                </td>
                <td className="px-4 py-2.5">
                  {confirmId === e.employeeId ? (
                    <span className="flex items-center gap-1.5">
                      <span className="text-xs text-red-600">Hapus?</span>
                      <button disabled={busy} onClick={() => doDelete(e.employeeId)} className="text-xs font-semibold text-red-700 hover:underline">Ya</button>
                      <button onClick={() => setConfirmId(null)} className="text-xs text-muted-foreground hover:underline">Batal</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <button onClick={() => openEdit(e)} title="Edit" className="text-muted-foreground hover:text-primary"><FileText className="w-4 h-4" /></button>
                      <button disabled={busy} onClick={() => doReset(e.employeeId)} title="Reset kode" className="text-muted-foreground hover:text-amber-600"><QrCode className="w-4 h-4" /></button>
                      <button onClick={() => setConfirmId(e.employeeId)} title="Hapus" className="text-muted-foreground hover:text-red-600"><X className="w-4 h-4" /></button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Modul Lokasi & QR (admin): daftar + tambah lokasi (koordinat GPS asli) + buat
// QR dinamis. "Pakai lokasi saya" mengisi koordinat dari GPS perangkat admin.
function LokasiTab({ token, locations, onCreate }: {
  token: string;
  locations: ApiLocation[];
  onCreate: (b: LocationInput) => Promise<void>;
}) {
  const EMPTY: LocationInput = { name: "", address: "", type: "office", lat: null, lng: null, radius_m: 100 };
  const [mode, setMode] = useState<"list" | "form">("list");
  const [form, setForm] = useState<LocationInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState<{ loc: string; url: string; codeId: string; type: "dynamic" | "static" } | null>(null);
  const inputCls = "w-full px-3 py-2 rounded-lg border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

  const useMyGps = async () => {
    setErr("");
    try { const g = await getDeviceGps(); setForm(f => ({ ...f, lat: g.lat, lng: g.lng })); }
    catch (e: any) { setErr(e?.message || "Gagal ambil GPS"); }
  };
  const save = async () => {
    if (!form.name?.trim()) { setErr("Nama lokasi wajib"); return; }
    setBusy(true); setErr("");
    try { await onCreate({ ...form, radius_m: Number(form.radius_m) || 100 }); setMode("list"); }
    catch (e: any) { setErr(e?.message || "Gagal menyimpan"); }
    finally { setBusy(false); }
  };
  const genDynamic = async (locId: string) => {
    setBusy(true); setErr("");
    try { const r = await api.createDynamicCode(token, locId, "hourly"); setQr({ loc: locId, url: r.qrImageUrl, codeId: r.codeId, type: "dynamic" }); }
    catch (e: any) { setErr(e?.message || "Gagal membuat QR"); } finally { setBusy(false); }
  };
  const genStatic = async (locId: string) => {
    setBusy(true); setErr("");
    try { const r = await api.createStaticCode(token, locId); setQr({ loc: locId, url: r.qrImageUrl, codeId: r.codeId, type: "static" }); }
    catch (e: any) { setErr(e?.message || "Gagal membuat QR"); } finally { setBusy(false); }
  };
  const refreshQr = async () => {
    if (!qr) return; setBusy(true); setErr("");
    try { const r = await api.refreshCode(token, qr.loc, qr.codeId); setQr({ ...qr, url: r.qrImageUrl }); }
    catch (e: any) { setErr(e?.message || "Gagal refresh"); } finally { setBusy(false); }
  };
  const deactivateQr = async () => {
    if (!qr) return; setBusy(true); setErr("");
    try { await api.updateCode(token, qr.loc, qr.codeId, { status: "inactive" }); setQr(null); setErr("Kode dinonaktifkan."); }
    catch (e: any) { setErr(e?.message || "Gagal menonaktifkan"); } finally { setBusy(false); }
  };

  if (mode === "form") return (
    <div className="bg-card rounded-xl border border-border p-5 max-w-xl space-y-3">
      <p className="font-semibold text-sm">Tambah Lokasi Absensi</p>
      {err && <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div><label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Nama Lokasi</label><input className={inputCls} placeholder="mis. Kantor Pusat" value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
      <div><label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Alamat</label><input className={inputCls} placeholder="Alamat lokasi" value={form.address ?? ""} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Latitude</label><input className={inputCls} type="number" step="any" placeholder="-6.2088" value={form.lat ?? ""} onChange={e => setForm(f => ({ ...f, lat: e.target.value === "" ? null : Number(e.target.value) }))} /></div>
        <div><label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Longitude</label><input className={inputCls} type="number" step="any" placeholder="106.8456" value={form.lng ?? ""} onChange={e => setForm(f => ({ ...f, lng: e.target.value === "" ? null : Number(e.target.value) }))} /></div>
      </div>
      <div><label className="text-xs font-semibold text-muted-foreground uppercase block mb-1">Radius validasi (meter)</label><input className={inputCls} type="number" placeholder="100" value={form.radius_m ?? 100} onChange={e => setForm(f => ({ ...f, radius_m: Number(e.target.value) }))} /></div>
      <button onClick={useMyGps} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"><MapPin className="w-3.5 h-3.5" />Pakai koordinat GPS saya sekarang</button>
      <div className="flex gap-2 pt-1">
        <button disabled={busy} onClick={save} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"><Check className="w-4 h-4" />{busy ? "Menyimpan…" : "Simpan"}</button>
        <button disabled={busy} onClick={() => setMode("list")} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted/40">Batal</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{locations.length} lokasi terdaftar</p>
        <button onClick={() => { setForm(EMPTY); setErr(""); setMode("form"); }} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90"><MapPin className="w-4 h-4" />Tambah Lokasi</button>
      </div>
      {err && <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      {locations.length === 0 && <p className="text-center text-muted-foreground text-sm py-8">Belum ada lokasi. Tambah kantor + koordinat GPS-nya agar validasi radius berfungsi.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {locations.map(l => (
          <div key={l.locationId} className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-sm">{l.name}</p>
                <p className="text-xs text-muted-foreground">{l.address || "—"}</p>
                <p className="text-[11px] font-mono text-muted-foreground mt-1">{l.lat != null && l.lng != null ? `${l.lat}, ${l.lng}` : "GPS belum diset"} · radius {l.radius_m}m</p>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">{l.type}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => genDynamic(l.locationId)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 disabled:opacity-50"><Zap className="w-3.5 h-3.5" />QR Dinamis</button>
              <button disabled={busy} onClick={() => genStatic(l.locationId)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-semibold hover:bg-muted/70 disabled:opacity-50"><QrCode className="w-3.5 h-3.5" />QR Statis</button>
            </div>
            {qr?.loc === l.locationId && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <img src={qr.url} alt="QR lokasi" width={140} height={140} className="rounded border border-border" />
                <p className="text-[10px] text-muted-foreground text-center">QR {qr.type === "dynamic" ? "dinamis" : "statis"} aktif — tampilkan/tempel di pintu masuk</p>
                <div className="flex gap-2">
                  {qr.type === "dynamic" && <button disabled={busy} onClick={refreshQr} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted/40"><RefreshCw className="w-3 h-3" />Refresh</button>}
                  <button disabled={busy} onClick={deactivateQr} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 text-red-600 text-[11px] font-semibold hover:bg-red-50"><X className="w-3 h-3" />Nonaktifkan</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Modul Shift kerja (admin) — CRUD ke /api/shifts.
function ShiftTab({ token }: { token: string }) {
  const [items, setItems] = useState<Array<{ shiftId: string; name: string; start: string; end: string }>>([]);
  const [form, setForm] = useState({ name: "", start: "08:00", end: "17:00" });
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(() => { api.shifts(token).then(setItems).catch((e: any) => setErr(e.message)); }, [token]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    if (!form.name.trim()) { setErr("Nama shift wajib"); return; }
    setBusy(true); setErr("");
    try { if (editId) await api.updateShift(token, editId, form); else await api.createShift(token, form); setForm({ name: "", start: "08:00", end: "17:00" }); setEditId(null); load(); }
    catch (e: any) { setErr(e?.message || "Gagal"); } finally { setBusy(false); }
  };
  const inputCls = "px-3 py-2 rounded-lg border border-border text-sm";
  return (
    <div className="space-y-3 max-w-2xl">
      {err && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Nama Shift</label><input className={inputCls} placeholder="mis. Pagi" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Mulai</label><input type="time" className={inputCls} value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} /></div>
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Selesai</label><input type="time" className={inputCls} value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} /></div>
        <button disabled={busy} onClick={save} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">{editId ? "Update" : "Tambah"}</button>
        {editId && <button onClick={() => { setEditId(null); setForm({ name: "", start: "08:00", end: "17:00" }); }} className="px-3 py-2 rounded-lg border border-border text-sm">Batal</button>}
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm"><thead><tr className="border-b border-border bg-muted/30">{["Shift", "Mulai", "Selesai", ""].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-sm">Belum ada shift.</td></tr>}
            {items.map(s => <tr key={s.shiftId} className="hover:bg-muted/20"><td className="px-4 py-2.5 font-semibold">{s.name}</td><td className="px-4 py-2.5 font-mono">{s.start}</td><td className="px-4 py-2.5 font-mono">{s.end}</td><td className="px-4 py-2.5"><button onClick={() => { setEditId(s.shiftId); setForm({ name: s.name, start: s.start, end: s.end }); }} className="text-primary text-xs hover:underline">Edit</button></td></tr>)}
          </tbody></table>
      </div>
    </div>
  );
}

// Modul Perangkat terdaftar (admin) — /api/devices.
function DeviceTab({ token, employees }: { token: string; employees: ApiEmployee[] }) {
  const [items, setItems] = useState<Array<{ id: string; employeeId: string; deviceId: string; label: string | null }>>([]);
  const [form, setForm] = useState({ employeeId: "", deviceId: "", label: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(() => { api.devices(token).then(setItems).catch((e: any) => setErr(e.message)); }, [token]);
  useEffect(() => { load(); }, [load]);
  const save = async () => {
    if (!form.employeeId || !form.deviceId.trim()) { setErr("Karyawan & ID perangkat wajib"); return; }
    setBusy(true); setErr("");
    try { await api.createDevice(token, form); setForm({ employeeId: "", deviceId: "", label: "" }); load(); }
    catch (e: any) { setErr(e?.message || "Gagal"); } finally { setBusy(false); }
  };
  const inputCls = "px-3 py-2 rounded-lg border border-border text-sm";
  return (
    <div className="space-y-3 max-w-2xl">
      {err && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Karyawan</label>
          <select className={inputCls} value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}><option value="">Pilih…</option>{employees.map(e => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</select></div>
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">ID Perangkat</label><input className={inputCls} placeholder="device id / IMEI" value={form.deviceId} onChange={e => setForm(f => ({ ...f, deviceId: e.target.value }))} /></div>
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Label</label><input className={inputCls} placeholder="mis. HP Budi" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></div>
        <button disabled={busy} onClick={save} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">Daftarkan</button>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm"><thead><tr className="border-b border-border bg-muted/30">{["Karyawan", "ID Perangkat", "Label"].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {items.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground text-sm">Belum ada perangkat terdaftar.</td></tr>}
            {items.map(d => { const e = employees.find(x => x.employeeId === d.employeeId); return <tr key={d.id} className="hover:bg-muted/20"><td className="px-4 py-2.5 font-semibold">{e?.name ?? d.employeeId}</td><td className="px-4 py-2.5 font-mono text-xs">{d.deviceId}</td><td className="px-4 py-2.5">{d.label ?? "—"}</td></tr>; })}
          </tbody></table>
      </div>
    </div>
  );
}

// Modul Riwayat presensi per karyawan (admin) — /api/employees/:id/attendance.
function RiwayatTab({ token, employees }: { token: string; employees: ApiEmployee[] }) {
  const [empId, setEmpId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rows, setRows] = useState<Array<{ date: string; check_in: string | null; check_out: string | null; status: string; method: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = async () => {
    if (!empId) { setErr("Pilih karyawan"); return; }
    setBusy(true); setErr("");
    try { setRows(await api.employeeAttendance(token, empId, { start, end })); }
    catch (e: any) { setErr(e?.message || "Gagal"); } finally { setBusy(false); }
  };
  const inputCls = "px-3 py-2 rounded-lg border border-border text-sm";
  return (
    <div className="space-y-3 max-w-3xl">
      {err && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Karyawan</label><select className={inputCls} value={empId} onChange={e => setEmpId(e.target.value)}><option value="">Pilih…</option>{employees.map(e => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</select></div>
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Dari</label><input type="date" className={inputCls} value={start} onChange={e => setStart(e.target.value)} /></div>
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Sampai</label><input type="date" className={inputCls} value={end} onChange={e => setEnd(e.target.value)} /></div>
        <button disabled={busy} onClick={load} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">{busy ? "Memuat…" : "Tampilkan"}</button>
      </div>
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm"><thead><tr className="border-b border-border bg-muted/30">{["Tanggal", "Masuk", "Keluar", "Status", "Metode"].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground text-sm">Pilih karyawan lalu "Tampilkan".</td></tr>}
            {rows.map((r, i) => <tr key={i} className="hover:bg-muted/20"><td className="px-4 py-2.5 font-mono">{r.date}</td><td className="px-4 py-2.5 font-mono">{r.check_in ?? "—"}</td><td className="px-4 py-2.5 font-mono">{r.check_out ?? "—"}</td><td className="px-4 py-2.5"><StatusBadge status={r.status as AttendanceRecord["status"]} /></td><td className="px-4 py-2.5 text-xs">{r.method ?? "—"}</td></tr>)}
          </tbody></table>
      </div>
    </div>
  );
}

// Modul Pengaturan perusahaan + multi-cabang (admin) — /api/company*, /api/company/register.
function PengaturanTab({ token }: { token: string }) {
  const [co, setCo] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [newCo, setNewCo] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.company(token).then(setCo).catch((e: any) => setErr(e.message));
    api.companySettings(token).then(setSettings).catch(() => {});
  }, [token]);
  const saveProfile = async () => {
    setBusy(true); setErr(""); setMsg("");
    try { await api.updateCompany(token, { name: co.name, address: co.address, contact_email: co.contact_email, industry: co.industry, work_hours: co.work_hours }); if (co.logo_url) await api.setLogo(token, co.logo_url); setMsg("Profil tersimpan"); }
    catch (e: any) { setErr(e?.message || "Gagal"); } finally { setBusy(false); }
  };
  const saveSettings = async () => {
    setBusy(true); setErr(""); setMsg("");
    try { await api.updateCompanySettings(token, settings); setMsg("Pengaturan tersimpan"); }
    catch (e: any) { setErr(e?.message || "Gagal"); } finally { setBusy(false); }
  };
  const addCompany = async () => {
    if (!newCo.trim()) return;
    setBusy(true); setErr(""); setMsg("");
    try { await api.registerCompany(token, { company_name: newCo.trim() }); setNewCo(""); setMsg("Perusahaan/cabang ditambahkan"); }
    catch (e: any) { setErr(e?.message || "Gagal"); } finally { setBusy(false); }
  };
  const inputCls = "w-full px-3 py-2 rounded-lg border border-border text-sm";
  if (!co) return <p className="text-muted-foreground text-sm">{err || "Memuat…"}</p>;
  return (
    <div className="space-y-4 max-w-xl">
      {err && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      {msg && <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</div>}
      <div className="bg-card rounded-xl border border-border p-5 space-y-3">
        <p className="font-semibold text-sm">Profil Perusahaan</p>
        <div><label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Nama</label><input className={inputCls} value={co.name ?? ""} onChange={e => setCo({ ...co, name: e.target.value })} /></div>
        <div><label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Alamat</label><input className={inputCls} value={co.address ?? ""} onChange={e => setCo({ ...co, address: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Jam Masuk</label><input type="time" className={inputCls} value={co.work_hours?.start ?? ""} onChange={e => setCo({ ...co, work_hours: { ...co.work_hours, start: e.target.value } })} /></div>
          <div><label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Jam Keluar</label><input type="time" className={inputCls} value={co.work_hours?.end ?? ""} onChange={e => setCo({ ...co, work_hours: { ...co.work_hours, end: e.target.value } })} /></div>
        </div>
        <div><label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Logo URL</label><input className={inputCls} placeholder="https://…" value={co.logo_url ?? ""} onChange={e => setCo({ ...co, logo_url: e.target.value })} /></div>
        <button disabled={busy} onClick={saveProfile} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">Simpan Profil</button>
      </div>
      {settings && <div className="bg-card rounded-xl border border-border p-5 space-y-3">
        <p className="font-semibold text-sm">Pengaturan Aplikasi</p>
        <div><label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Mode Absensi</label>
          <select className={inputCls} value={settings.attendance_mode} onChange={e => setSettings({ ...settings, attendance_mode: e.target.value })}><option value="qr_dynamic">QR Dinamis</option><option value="qr_static">QR Statis</option><option value="terminal_scan">Terminal Scan</option></select></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Zona Waktu</label><input className={inputCls} value={settings.timezone ?? ""} onChange={e => setSettings({ ...settings, timezone: e.target.value })} /></div>
          <div><label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Bahasa</label><input className={inputCls} value={settings.language ?? ""} onChange={e => setSettings({ ...settings, language: e.target.value })} /></div>
        </div>
        <button disabled={busy} onClick={saveSettings} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">Simpan Pengaturan</button>
      </div>}
      <div className="bg-card rounded-xl border border-border p-5 space-y-3">
        <p className="font-semibold text-sm">Tambah Perusahaan / Cabang</p>
        <div className="flex gap-2"><input className={inputCls} placeholder="Nama perusahaan/cabang baru" value={newCo} onChange={e => setNewCo(e.target.value)} /><button disabled={busy} onClick={addCompany} className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-semibold disabled:opacity-50 whitespace-nowrap">Tambah</button></div>
      </div>
    </div>
  );
}

// Modul Log audit aktivitas admin (admin) — /api/logs.
function LogTab({ token }: { token: string }) {
  const [rows, setRows] = useState<Array<{ id: string; action: string; detail: string | null; created_at: string }>>([]);
  const [err, setErr] = useState("");
  useEffect(() => { api.logs(token).then(setRows).catch((e: any) => setErr(e.message)); }, [token]);
  return (
    <div className="space-y-3">
      {err && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm"><thead><tr className="border-b border-border bg-muted/30">{["Waktu", "Aksi", "Detail"].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-muted-foreground text-sm">Belum ada log.</td></tr>}
            {rows.map(l => <tr key={l.id} className="hover:bg-muted/20"><td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{l.created_at}</td><td className="px-4 py-2.5 font-semibold text-xs">{l.action}</td><td className="px-4 py-2.5 text-xs text-muted-foreground">{l.detail ?? "—"}</td></tr>)}
          </tbody></table>
      </div>
    </div>
  );
}

// Modul Penggajian (admin) — komponen gaji + aturan otomatis + proses payroll +
// slip (terintegrasi absensi via /api/payroll*).
const BASIS_LABEL: Record<string, string> = { fixed: "Tetap", percent_base: "% gaji pokok", per_late_min: "per menit telat", per_absent_day: "per hari alpa", per_overtime_hour: "per jam lembur" };
const METRIC_LABEL: Record<string, string> = { late_days: "Hari telat", late_minutes: "Menit telat", overtime_hours: "Jam lembur", absent_days: "Hari alpa", leave_days: "Hari cuti" };
const rupiah = (n: number) => "Rp " + (n || 0).toLocaleString("id-ID");

function PayrollTab({ token }: { token: string }) {
  const [comps, setComps] = useState<SalaryComponent[]>([]);
  const [rules, setRules] = useState<PayrollRule[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [slips, setSlips] = useState<Payslip[] | null>(null);
  const [detail, setDetail] = useState<Payslip | null>(null);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [cForm, setCForm] = useState({ name: "", type: "earning", basis: "fixed", value: 0 });
  const [rForm, setRForm] = useState({ name: "", metric: "late_days", op: "gte", threshold: 0, action: "deduction", amount: 0 });
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [currency, setCurrency] = useState("IDR");
  const inputCls = "px-3 py-2 rounded-lg border border-border text-sm";

  const load = useCallback(() => {
    api.salaryComponents(token).then(setComps).catch((e: any) => setErr(e.message));
    api.payrollRules(token).then(setRules).catch(() => {});
    api.payrollRuns(token).then(setRuns).catch(() => {});
    api.exchangeRates(token).then(setRates).catch(() => {});
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Konversi mata uang: kurs terbaru per currency (1 unit = rate IDR).
  const latestRate: Record<string, number> = {};
  for (const r of rates) if (!latestRate[r.currency]) latestRate[r.currency] = r.rate;
  const fmt = (idr: number) => {
    if (currency === "IDR" || !latestRate[currency]) return rupiah(idr);
    return `${currency} ${(idr / latestRate[currency]).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
  };

  const addComp = async () => { if (!cForm.name.trim()) { setErr("Nama komponen wajib"); return; } setBusy(true); setErr(""); try { await api.createSalaryComponent(token, { ...cForm, value: Number(cForm.value) || 0 }); setCForm({ name: "", type: "earning", basis: "fixed", value: 0 }); load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const addRule = async () => { if (!rForm.name.trim()) { setErr("Nama aturan wajib"); return; } setBusy(true); setErr(""); try { await api.createPayrollRule(token, { ...rForm, threshold: Number(rForm.threshold) || 0, amount: Number(rForm.amount) || 0 }); setRForm({ name: "", metric: "late_days", op: "gte", threshold: 0, action: "deduction", amount: 0 }); load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const viewSlips = async (runId: string) => { setBusy(true); setErr(""); try { setSlips(await api.runPayslips(token, runId)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const runNow = async () => { setBusy(true); setErr(""); setMsg(""); try { const r = await api.runPayroll(token, period); setMsg(`Payroll ${r.period}: ${r.count} slip · total ${rupiah(r.totalNet)}`); load(); await viewSlips(r.runId); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };

  return (
    <div className="space-y-4 max-w-4xl">
      {err && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      {msg && <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2"><CheckCircle2 className="w-3.5 h-3.5" />{msg}</div>}

      {/* Proses payroll */}
      <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Periode</label><input type="month" className={inputCls} value={period} onChange={e => setPeriod(e.target.value)} /></div>
        <button disabled={busy} onClick={runNow} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5"><Download className="w-4 h-4" />{busy ? "Memproses…" : "Proses Payroll"}</button>
        <p className="text-xs text-muted-foreground">Tarik otomatis dari absensi (telat, lembur, alpa, cuti) + komponen & aturan di bawah.</p>
      </div>

      {/* Komponen gaji */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <p className="font-semibold text-sm">Komponen Gaji (tunjangan / potongan)</p>
        <div className="flex flex-wrap items-end gap-2">
          <input className={inputCls} placeholder="Nama (mis. Transport)" value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))} />
          <select className={inputCls} value={cForm.type} onChange={e => setCForm(f => ({ ...f, type: e.target.value }))}><option value="earning">Tunjangan (+)</option><option value="deduction">Potongan (−)</option></select>
          <select className={inputCls} value={cForm.basis} onChange={e => setCForm(f => ({ ...f, basis: e.target.value }))}>{Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input type="number" className={inputCls + " w-32"} placeholder="Nilai" value={cForm.value} onChange={e => setCForm(f => ({ ...f, value: Number(e.target.value) }))} />
          <button disabled={busy} onClick={addComp} className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Tambah</button>
        </div>
        <div className="flex flex-wrap gap-2">
          {comps.length === 0 && <p className="text-xs text-muted-foreground">Belum ada komponen.</p>}
          {comps.map(c => (
            <span key={c.id} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${c.type === "earning" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
              {c.name}: {c.basis === "fixed" || c.basis === "percent_base" ? c.value : c.value} <span className="opacity-60">({BASIS_LABEL[c.basis]})</span>
              <button onClick={() => api.deleteSalaryComponent(token, c.id).then(load)} className="hover:text-foreground"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      </div>

      {/* Aturan otomatis */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-3">
        <p className="font-semibold text-sm">Aturan Otomatis (pemicu kondisi)</p>
        <div className="flex flex-wrap items-end gap-2">
          <input className={inputCls} placeholder="Nama aturan" value={rForm.name} onChange={e => setRForm(f => ({ ...f, name: e.target.value }))} />
          <select className={inputCls} value={rForm.metric} onChange={e => setRForm(f => ({ ...f, metric: e.target.value }))}>{Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className={inputCls} value={rForm.op} onChange={e => setRForm(f => ({ ...f, op: e.target.value }))}><option value="gte">≥</option><option value="gt">&gt;</option></select>
          <input type="number" className={inputCls + " w-24"} placeholder="Ambang" value={rForm.threshold} onChange={e => setRForm(f => ({ ...f, threshold: Number(e.target.value) }))} />
          <select className={inputCls} value={rForm.action} onChange={e => setRForm(f => ({ ...f, action: e.target.value }))}><option value="deduction">Potongan</option><option value="bonus">Bonus</option></select>
          <input type="number" className={inputCls + " w-32"} placeholder="Jumlah Rp" value={rForm.amount} onChange={e => setRForm(f => ({ ...f, amount: Number(e.target.value) }))} />
          <button disabled={busy} onClick={addRule} className="px-3 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Tambah</button>
        </div>
        <div className="space-y-1">
          {rules.length === 0 && <p className="text-xs text-muted-foreground">Belum ada aturan.</p>}
          {rules.map(r => (
            <div key={r.id} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-1.5">
              <span><b>{r.name}</b> — jika {METRIC_LABEL[r.metric]} {r.op === "gt" ? ">" : "≥"} {r.threshold} → {r.action === "bonus" ? "bonus" : "potongan"} {rupiah(r.amount)}</span>
              <button onClick={() => api.deletePayrollRule(token, r.id).then(load)} className="text-muted-foreground hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Slip hasil run terakhir */}
      {slips && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center justify-between">
            <span className="text-sm font-semibold">Slip Gaji ({slips.length})</span>
            <label className="text-xs flex items-center gap-1.5 text-muted-foreground">Tampilkan dalam:
              <select className="px-2 py-1 rounded-lg border border-border text-xs" value={currency} onChange={e => setCurrency(e.target.value)}>
                <option value="IDR">IDR (Rp)</option>
                {Object.keys(latestRate).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          {currency !== "IDR" && latestRate[currency] && <p className="px-4 pt-2 text-[11px] text-muted-foreground">Konversi kurs: 1 {currency} = {rupiah(latestRate[currency])} (transparan, dari Manajemen Kurs).</p>}
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/20">{["Karyawan", "Pokok", "Tunjangan", "Potongan", "Net", ""].map(h => <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {slips.map(s => (
                <tr key={s.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold">{s.name}</td>
                  <td className="px-4 py-2 font-mono">{fmt(s.base_salary)}</td>
                  <td className="px-4 py-2 font-mono text-emerald-600">+{fmt(s.earnings)}</td>
                  <td className="px-4 py-2 font-mono text-red-600">−{fmt(s.deductions)}</td>
                  <td className="px-4 py-2 font-mono font-bold">{fmt(s.net)}</td>
                  <td className="px-4 py-2"><button onClick={() => setDetail(s)} className="text-primary text-xs hover:underline">Rincian</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Riwayat run */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-2">
        <p className="font-semibold text-sm">Riwayat Proses Payroll</p>
        {runs.length === 0 && <p className="text-xs text-muted-foreground">Belum ada proses payroll.</p>}
        {runs.map(r => (
          <div key={r.runId} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-1.5">
            <span>Periode <b>{r.period}</b> · {r.count} slip · total {rupiah(r.totalNet)}</span>
            <button onClick={() => viewSlips(r.runId)} className="text-primary font-semibold hover:underline">Lihat slip</button>
          </div>
        ))}
      </div>

      {/* Detail slip (modal sederhana) */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
          <div className="bg-card rounded-xl border border-border p-5 w-full max-w-md max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><p className="font-bold text-sm">Slip {detail.name} · {detail.period}</p><button onClick={() => setDetail(null)}><X className="w-4 h-4" /></button></div>
            <div className="text-xs space-y-1 mb-3 text-muted-foreground">
              {detail.detail && Object.entries(detail.detail.metrics).map(([k, v]) => <div key={k} className="flex justify-between"><span>{METRIC_LABEL[k] || k}</span><span className="font-mono">{v}</span></div>)}
            </div>
            <div className="border-t border-border pt-2 space-y-1 text-sm">
              <div className="flex justify-between"><span>Gaji Pokok</span><span className="font-mono">{fmt(detail.base_salary)}</span></div>
              {detail.detail?.lines.map((l, i) => <div key={i} className={`flex justify-between ${l.type === "earning" ? "text-emerald-600" : "text-red-600"}`}><span>{l.name}</span><span className="font-mono">{l.type === "earning" ? "+" : "−"}{fmt(l.amount)}</span></div>)}
              <div className="flex justify-between font-bold border-t border-border pt-1.5 mt-1.5"><span>Gaji Bersih</span><span className="font-mono">{fmt(detail.net)}</span></div>
              {currency !== "IDR" && latestRate[currency] && <p className="text-[10px] text-muted-foreground pt-1">Kurs 1 {currency} = {rupiah(latestRate[currency])}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Modul Manajemen Kurs (admin) — nilai tukar harian untuk konversi slip gaji.
function KursTab({ token }: { token: string }) {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ currency: "", rate: 0, date: today });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = useCallback(() => { api.exchangeRates(token).then(setRates).catch((e: any) => setErr(e.message)); }, [token]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    if (!form.currency.trim() || !(Number(form.rate) > 0)) { setErr("Kode mata uang & kurs (>0) wajib"); return; }
    setBusy(true); setErr("");
    try { await api.createExchangeRate(token, { currency: form.currency.toUpperCase(), rate: Number(form.rate), date: form.date }); setForm({ currency: "", rate: 0, date: today }); load(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const latest: Record<string, ExchangeRate> = {};
  for (const r of rates) if (!latest[r.currency]) latest[r.currency] = r;
  const inputCls = "px-3 py-2 rounded-lg border border-border text-sm";
  return (
    <div className="space-y-3 max-w-3xl">
      {err && <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" />{err}</div>}
      <div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Mata Uang</label><input className={inputCls + " w-28 uppercase"} placeholder="USD" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} /></div>
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Kurs (1 unit = Rp)</label><input type="number" className={inputCls + " w-40"} placeholder="16000" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: Number(e.target.value) }))} /></div>
        <div className="flex flex-col"><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">Tanggal</label><input type="date" className={inputCls} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
        <button disabled={busy} onClick={add} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">Simpan Kurs</button>
      </div>
      <p className="text-xs text-muted-foreground">Masukkan kurs resmi (mis. kurs tengah BI / mid-market). Konversi slip gaji memakai kurs terbaru per mata uang. <b>1 {form.currency || "USD"} = Rp …</b></p>

      <div className="flex flex-wrap gap-2">
        {Object.values(latest).map(r => (
          <span key={r.currency} className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-semibold">1 {r.currency} = {rupiah(r.rate)} <span className="opacity-60 font-normal">({r.date})</span></span>
        ))}
        {rates.length === 0 && <p className="text-xs text-muted-foreground">Belum ada kurs.</p>}
      </div>

      {rates.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm"><thead><tr className="border-b border-border bg-muted/30">{["Tanggal", "Mata Uang", "Kurs (Rp)", ""].map(h => <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {rates.map(r => (
                <tr key={r.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-mono">{r.date}</td><td className="px-4 py-2 font-semibold">{r.currency}</td><td className="px-4 py-2 font-mono">{rupiah(r.rate)}</td>
                  <td className="px-4 py-2"><button onClick={() => api.deleteExchangeRate(token, r.id).then(load)} className="text-muted-foreground hover:text-red-600"><X className="w-3.5 h-3.5" /></button></td>
                </tr>
              ))}
            </tbody></table>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// Backend (REST API Zylora)
// Menggantikan mock state + relay SSE: login admin sekali, lalu polling backend
// sebagai sumber kebenaran (pengganti "real-time sync"). Semua mutasi —
// check-in/out & approve cuti — ditulis ke API lalu di-refresh.
// ═══════════════════════════════════════════════════════════════════════════════

const POLL_MS = 4000;

const coversToday = (start: string, end: string, today: string) => start <= today && end >= today;

// enabled=false untuk port app-karyawan (QR Lokasi :5173): port itu TIDAK boleh
// login sebagai admin — karyawan auth sendiri di QRLokasiEmployeeApp.
function useBackendData(enabled = true) {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<ApiEmployee[]>([]);
  const [locations, setLocations] = useState<ApiLocation[]>([]);
  const [connected, setConnected] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const codeCache = useRef<Record<string, string>>({});

  // Petakan data backend → bentuk yang dipakai komponen view. Mencakup SEMUA
  // karyawan: pakai record presensi bila ada, lalu cuti yang disetujui untuk hari
  // ini, lalu default tidak_hadir.
  const refresh = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [board, leaves, emps, locs] = await Promise.all([api.attendance(t), api.leaves(t), api.employees(t), api.locations(t)]);
      setEmployees(emps);
      setLocations(locs);
      const lr: LeaveRequest[] = leaves.map((l: ApiLeaveRow) => ({
        id: l.requestId, employeeId: l.employeeId,
        type: l.type === "cuti" ? "cuti" : "izin",
        startDate: l.start_date, endDate: l.end_date,
        reason: l.reason ?? "", status: l.status as LeaveRequest["status"],
      }));
      const approvedToday = lr.filter(l => l.status === "approved" && coversToday(l.startDate, l.endDate, today));
      // Papan kehadiran dari karyawan ASLI (bukan mock): tiap karyawan → presensi
      // hari ini bila ada, lalu cuti disetujui, lalu default tidak_hadir.
      const att: AttendanceRecord[] = emps.map(emp => {
        const row = board.find((r: ApiAttendanceRow) => r.employeeId === emp.employeeId);
        if (row && (row.check_in || row.check_out)) {
          return {
            id: emp.employeeId, employeeId: emp.employeeId, date: today,
            checkIn: row.check_in, checkOut: row.check_out,
            status: row.status as AttendanceRecord["status"],
            location: "—",
            method: (row.method as AttendanceRecord["method"]) ?? "manual",
          };
        }
        const lv = approvedToday.find(l => l.employeeId === emp.employeeId);
        if (lv) return {
          id: emp.employeeId, employeeId: emp.employeeId, date: today, checkIn: null, checkOut: null,
          status: lv.type, location: "—", method: "manual",
        };
        return {
          id: emp.employeeId, employeeId: emp.employeeId, date: today, checkIn: null, checkOut: null,
          status: "tidak_hadir", location: "—", method: "manual",
        };
      });
      setAttendance(att);
      setLeaveRequests(lr);
      setConnected(true);
      setError(null);
    } catch (e: any) {
      setConnected(false);
      setError(e?.message ?? String(e));
    }
  }, []);

  // Login admin EKSPLISIT (form), bukan auto-login demo. Token disimpan di memori
  // (sesi); produksi bersih → admin login pakai kredensial perusahaannya sendiri.
  const login = useCallback(async (email: string, password: string) => {
    const r = await api.controlLogin(email.trim(), password);
    tokenRef.current = r.token;
    setToken(r.token);
    setAuthed(true);
    setError(null);
    await refresh();
  }, [refresh]);

  const logout = useCallback(() => {
    const t = tokenRef.current;
    if (t) { api.controlLogout?.(t).catch(() => {}); }
    tokenRef.current = null;
    setToken(null);
    setAuthed(false);
    setAttendance([]); setLeaveRequests([]); setEmployees([]); setLocations([]);
    codeCache.current = {};
  }, []);

  // Polling hanya setelah login.
  useEffect(() => {
    if (!enabled || !authed) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, authed, refresh]);

  // Kode personal karyawan (di-cache) — proof-of-identity saat check-in.
  const codeFor = useCallback(async (empId: string) => {
    if (!codeCache.current[empId]) {
      const c = await api.employeeCode(tokenRef.current!, empId);
      codeCache.current[empId] = c.code;
    }
    return codeCache.current[empId];
  }, []);

  const checkIn = useCallback(async (empId: string, method: string) => {
    try {
      const [code, loc] = await Promise.all([codeFor(empId), api.publicLocation()]);
      await api.checkin({ employee_code: code, location_token: loc.token, lat: loc.lat, lng: loc.lng, method });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    await refresh();
  }, [codeFor, refresh]);

  const checkOut = useCallback(async (empId: string) => {
    try {
      const [code, loc] = await Promise.all([codeFor(empId), api.publicLocation()]);
      await api.checkout({ employee_code: code, location_token: loc.token });
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
    await refresh();
  }, [codeFor, refresh]);

  const approveLeave = useCallback(async (id: string) => {
    try { await api.approveLeave(tokenRef.current!, id, true); } catch (e: any) { setError(e?.message ?? String(e)); }
    await refresh();
  }, [refresh]);

  const rejectLeave = useCallback(async (id: string) => {
    try { await api.approveLeave(tokenRef.current!, id, false); } catch (e: any) { setError(e?.message ?? String(e)); }
    await refresh();
  }, [refresh]);

  // CRUD karyawan — melempar error agar form bisa menampilkannya & hanya menutup saat sukses.
  const createEmployee = useCallback(async (body: EmployeeInput) => {
    await api.createEmployee(tokenRef.current!, body); await refresh();
  }, [refresh]);
  const updateEmployee = useCallback(async (id: string, body: EmployeeInput) => {
    await api.updateEmployee(tokenRef.current!, id, body); await refresh();
  }, [refresh]);
  const deleteEmployee = useCallback(async (id: string, soft = false) => {
    await api.deleteEmployee(tokenRef.current!, id, soft);
    codeCache.current = {}; await refresh();
  }, [refresh]);
  const resetEmployeeCode = useCallback(async (id: string) => {
    await api.resetEmployeeCode(tokenRef.current!, id);
    delete codeCache.current[id]; await refresh();
  }, [refresh]);

  // Lokasi & QR
  const createLocation = useCallback(async (body: LocationInput) => {
    await api.createLocation(tokenRef.current!, body); await refresh();
  }, [refresh]);
  const createLocationQr = useCallback(async (locationId: string, interval: "hourly" | "daily" = "hourly") => {
    const r = await api.createDynamicCode(tokenRef.current!, locationId, interval); await refresh(); return r;
  }, [refresh]);

  return {
    attendance, leaveRequests, employees, locations, connected, error,
    authed, token, login, logout,
    checkIn, checkOut, approveLeave, rejectLeave,
    createEmployee, updateEmployee, deleteEmployee, resetEmployeeCode,
    createLocation, createLocationQr,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// App #3 — Halaman Tampilan Barcode/QR Lokasi (layar kiosk di lokasi absen)
// Hanya menampilkan QR lokasi yang live dari backend (endpoint publik, tanpa login).
// "Dikendalikan" dari Sistem Kontrol: jenis kode (statis/dinamis) & interval diatur
// lewat endpoint kode lokasi; halaman ini cukup membaca /api/public/location.
// ═══════════════════════════════════════════════════════════════════════════════

function QRDisplayPage() {
  const now = useClock();
  const online = useOnline();
  const [loc, setLoc] = useState<ApiPublicLocation | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setLoc(await api.publicLocation()); setErr(null); }
    catch (e: any) { setErr(e?.message || "Gagal memuat QR"); }
  }, []);

  useEffect(() => {
    load();
    // Polling cepat: token sekali-pakai, seri naik tiap scan → QR harus segera
    // diperbarui di layar setelah ada yang memindai.
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="h-screen w-screen bg-[#0D1B2A] text-white flex flex-col items-center justify-center p-8 relative" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="absolute top-6 left-8 flex items-center gap-2 text-white/60 text-sm">
        <Activity className="w-4 h-4 text-accent" />Zylora Absensi
        {!online && <span className="flex items-center gap-1 text-red-400 ml-2"><WifiOff className="w-4 h-4" />Tidak ada internet</span>}
      </div>
      <div className="absolute top-6 right-8 font-mono text-2xl font-bold tabular-nums">{fmtTime(now)}</div>

      <p className="text-white/60 text-sm uppercase tracking-widest mb-1">{loc?.name ?? "Lokasi Absensi"}</p>
      <h1 className="text-2xl font-bold mb-6">Pindai untuk Absen</h1>

      <div className="bg-white rounded-3xl p-6 shadow-2xl">
        {loc?.qrImageUrl ? (
          <img src={loc.qrImageUrl} alt="QR Absensi" width={320} height={320} className="block rounded-xl" />
        ) : (
          <div className="w-[320px] h-[320px] flex items-center justify-center text-[#0D1B2A]/40 text-sm">
            {err ? "QR tidak tersedia" : "Memuat QR…"}
          </div>
        )}
      </div>

      {loc?.type === "qr_dynamic" && loc.serial != null && (
        <div className="mt-4 text-center">
          <p className="text-white/50 text-xs uppercase tracking-widest">Nomor Seri</p>
          <p className="font-mono text-3xl font-bold tabular-nums text-accent">#{loc.serial}</p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm">
        {loc?.type === "qr_dynamic" ? (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/15 text-accent border border-accent/30">
            <Zap className="w-4 h-4" />Kode dinamis · sekali pakai — seri berganti tiap scan
          </span>
        ) : loc ? (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/70 border border-white/20">
            <QrCode className="w-4 h-4" />Kode statis
          </span>
        ) : null}
      </div>
      <p className="text-white/40 text-xs mt-3">Buka aplikasi Zylora di ponsel lalu pindai kode di atas</p>
      {err && <p className="text-red-400 text-xs mt-3">{err}</p>}
      <p className="absolute bottom-6 text-white/30 text-[11px] font-mono">{fmtDate(now)}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Root App
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  // Pengaturan pratinjau QR di panel kontrol.
  const [qrVariant, setQrVariant] = useState<QRVariant>("dynamic");
  const [qrInterval, setQrInterval] = useState(60);

  // Sumber kebenaran: backend Zylora (REST API). Data admin hanya diambil untuk
  // peran 'control' (panel). Karyawan & display tak butuh hook admin.
  const { attendance, leaveRequests, employees, locations, authed, token, login, logout,
    approveLeave, rejectLeave, createEmployee, updateEmployee, deleteEmployee, resetEmployeeCode,
    createLocation, createLocationQr } = useBackendData(APP_ROLE === "control");

  // Halaman tampilan QR lokasi (kiosk/layar) — publik, tanpa login.
  if (APP_ROLE === "display") return <QRDisplayPage />;

  // Build per-role (VITE_ROLE) = deployment NYATA (APK/desktop): tampilkan langsung
  // app-nya tanpa "chrome" peraga prototipe (selektor Model Sistem + tab :5173/:5174,
  // yang hanya relevan untuk demo single-screen). Pola sama seperti isDisplay.
  if (APP_ROLE === "employee") return <QRLokasiEmployeeApp />;

  // Sistem Kontrol KHUSUS DESKTOP — blokir bila dijalankan sebagai app native (Android/iOS).
  // Desktop (Electron) memuat build web biasa → tanpa Capacitor → tetap tampil.
  if (APP_ROLE === "control" && typeof window !== "undefined" && (window as any).Capacitor?.isNativePlatform?.()) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#0D1B2A] p-6 text-center" style={{ fontFamily: "var(--font-sans)" }}>
        <div className="max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-[#1B3D72] flex items-center justify-center mx-auto mb-4"><Monitor className="w-7 h-7 text-white" /></div>
          <h2 className="text-white font-bold text-lg mb-2">Sistem Kontrol khusus Desktop</h2>
          <p className="text-white/60 text-sm">Panel admin tidak tersedia di aplikasi HP/Android. Buka aplikasi <b>desktop</b> (Windows/macOS/Linux) Zylora Sistem Kontrol.</p>
        </div>
      </div>
    );
  }
  if (APP_ROLE === "control") return (
    <div className="h-screen overflow-hidden bg-background" style={{ fontFamily: "var(--font-sans)" }}>
      <QRLokasiControlPanel attendance={attendance} leaveRequests={leaveRequests}
        onApproveLeave={approveLeave} onRejectLeave={rejectLeave}
        employees={employees} onCreateEmployee={createEmployee} onUpdateEmployee={updateEmployee}
        onDeleteEmployee={deleteEmployee} onResetCode={resetEmployeeCode}
        authed={authed} onLogin={login} onLogout={logout} token={token} connected={connected}
        locations={locations} onCreateLocation={createLocation} onCreateLocationQr={createLocationQr}
        qrVariant={qrVariant} setQrVariant={setQrVariant} qrInterval={qrInterval} setQrInterval={setQrInterval} />
    </div>
  );

  // Tanpa VITE_ROLE → JANGAN tampilkan demo. Build nyata (APK/desktop/web) selalu
  // menetapkan peran lewat VITE_ROLE; ini hanya pengaman bila dijalankan polos.
  return (
    <div className="h-screen flex items-center justify-center bg-[#0D1B2A] p-6 text-center" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-[#1B3D72] flex items-center justify-center mx-auto mb-4"><Activity className="w-7 h-7 text-accent" /></div>
        <h2 className="text-white font-bold text-lg mb-2">Zylora Absensi</h2>
        <p className="text-white/60 text-sm">Build ini tidak menetapkan peran. Jalankan dengan <code className="text-accent">VITE_ROLE=employee | control | display</code> (lihat skrip dev:employee / dev:control / dev:display).</p>
      </div>
    </div>
  );
}
