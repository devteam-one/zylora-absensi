import { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "motion/react";
import {
  QrCode, Users, Clock, CheckCircle2, LogOut, Shield,
  Calendar, MapPin, Search, Check, X, Scan, Bell,
  Building2, Timer, RefreshCw, FileText, BarChart2,
  UserCheck, UserX, Download, Activity, Wifi,
  Smartphone, Monitor, ArrowRight, ChevronRight,
  AlertTriangle, Eye, RotateCcw, Camera, Zap
} from "lucide-react";
import { api, type ApiAttendanceRow, type ApiLeaveRow, type ApiMe, type ApiPublicLocation, type ApiEmployee, type EmployeeInput } from "./api";

// ─── Types ────────────────────────────────────────────────────────────────────

type SystemMode = "qr_lokasi" | "terminal_scan";
type QRVariant = "static" | "dynamic";

interface Employee {
  id: string; name: string; department: string;
  position: string; email: string;
  scheduleIn: string; scheduleOut: string; avatar: string;
}

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

// ─── Static data ──────────────────────────────────────────────────────────────

const EMPLOYEES: Employee[] = [
  { id: "EMP001", name: "Budi Santoso", department: "Teknologi Informasi", position: "Software Engineer", email: "budi@nusantara.co.id", scheduleIn: "08:00", scheduleOut: "17:00", avatar: "BS" },
  { id: "EMP002", name: "Dewi Rahayu", department: "Sumber Daya Manusia", position: "HR Manager", email: "dewi@nusantara.co.id", scheduleIn: "08:00", scheduleOut: "17:00", avatar: "DR" },
  { id: "EMP003", name: "Ahmad Fauzi", department: "Keuangan", position: "Senior Akuntan", email: "ahmad@nusantara.co.id", scheduleIn: "08:00", scheduleOut: "17:00", avatar: "AF" },
  { id: "EMP004", name: "Siti Nurhaliza", department: "Marketing", position: "Marketing Manager", email: "siti@nusantara.co.id", scheduleIn: "08:00", scheduleOut: "17:00", avatar: "SN" },
  { id: "EMP005", name: "Rizki Pratama", department: "Operasional", position: "Supervisor", email: "rizki@nusantara.co.id", scheduleIn: "07:00", scheduleOut: "16:00", avatar: "RP" },
  { id: "EMP006", name: "Nisa Amalia", department: "Teknologi Informasi", position: "UI/UX Designer", email: "nisa@nusantara.co.id", scheduleIn: "08:00", scheduleOut: "17:00", avatar: "NA" },
  { id: "EMP007", name: "Hendra Wijaya", department: "Keuangan", position: "Finance Staff", email: "hendra@nusantara.co.id", scheduleIn: "08:00", scheduleOut: "17:00", avatar: "HW" },
  { id: "EMP008", name: "Maya Putri", department: "Marketing", position: "Content Creator", email: "maya@nusantara.co.id", scheduleIn: "09:00", scheduleOut: "18:00", avatar: "MP" },
];

const todayStr = new Date().toISOString().split("T")[0];
const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

const INITIAL_ATTENDANCE: AttendanceRecord[] = [
  { id: "A001", employeeId: "EMP001", date: todayStr, checkIn: "07:58", checkOut: null, status: "hadir", location: "Kantor Pusat Jakarta", method: "terminal" },
  { id: "A002", employeeId: "EMP002", date: todayStr, checkIn: "08:02", checkOut: null, status: "hadir", location: "Kantor Pusat Jakarta", method: "qr_lokasi" },
  { id: "A003", employeeId: "EMP003", date: todayStr, checkIn: "08:47", checkOut: null, status: "terlambat", location: "Kantor Pusat Jakarta", method: "qr_lokasi" },
  { id: "A004", employeeId: "EMP004", date: todayStr, checkIn: null, checkOut: null, status: "izin", location: "—", method: "manual" },
  { id: "A005", employeeId: "EMP005", date: todayStr, checkIn: "06:54", checkOut: "16:05", status: "hadir", location: "Kantor Pusat Jakarta", method: "terminal" },
  { id: "A006", employeeId: "EMP006", date: todayStr, checkIn: null, checkOut: null, status: "tidak_hadir", location: "—", method: "manual" },
  { id: "A007", employeeId: "EMP007", date: todayStr, checkIn: "07:59", checkOut: null, status: "hadir", location: "Kantor Pusat Jakarta", method: "terminal" },
  { id: "A008", employeeId: "EMP008", date: todayStr, checkIn: null, checkOut: null, status: "tidak_hadir", location: "—", method: "manual" },
];

const INITIAL_LEAVE: LeaveRequest[] = [
  { id: "L001", employeeId: "EMP004", type: "izin", startDate: todayStr, endDate: todayStr, reason: "Keperluan keluarga mendesak — orang tua sakit.", status: "approved" },
  { id: "L002", employeeId: "EMP006", type: "cuti", startDate: todayStr, endDate: tomorrow, reason: "Cuti tahunan yang telah direncanakan.", status: "pending" },
  { id: "L003", employeeId: "EMP003", type: "izin", startDate: tomorrow, endDate: tomorrow, reason: "Pemeriksaan kesehatan rutin.", status: "pending" },
  { id: "L004", employeeId: "EMP008", type: "cuti", startDate: todayStr, endDate: todayStr, reason: "Urusan administrasi kependudukan.", status: "rejected" },
];

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
// Relay lives next to whatever host served this page (e.g. 127.0.0.2) on :5180.
const SYNC_URL = typeof window !== "undefined" ? `http://${window.location.hostname}:5180` : "";

type SyncSnapshot = {
  systemMode: SystemMode;
  attendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
};

// Per-tab id used to tag our own posts so we can ignore their echo.
const CLIENT_ID = Math.random().toString(36).slice(2);
let syncSeq = 0;

function useSyncedState(
  enabled: boolean,
  snapshot: SyncSnapshot,
  apply: (s: SyncSnapshot) => void,
) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const myTag = useRef("");
  const body = JSON.stringify(snapshot);
  // Seed with the initial snapshot so we don't clobber the relay on mount.
  const sentBody = useRef(body);

  // Receive: adopt any snapshot that isn't the echo of our own last post.
  useEffect(() => {
    if (!enabled || !SYNC_URL) return;
    const es = new EventSource(`${SYNC_URL}/events`);
    es.onmessage = (e) => {
      try {
        const inc = JSON.parse(e.data) as SyncSnapshot & { _tag?: string };
        if (inc._tag && inc._tag === myTag.current) return; // our own echo
        const { _tag, ...clean } = inc;
        // Mark as already-sent so applying it below doesn't bounce back out.
        sentBody.current = JSON.stringify(clean);
        applyRef.current(clean as SyncSnapshot);
      } catch { /* ignore malformed */ }
    };
    return () => es.close();
  }, [enabled]);

  // Send: POST the snapshot whenever it changes locally.
  useEffect(() => {
    if (!enabled || !SYNC_URL) return;
    if (body === sentBody.current) return;
    sentBody.current = body;
    const tag = `${CLIENT_ID}-${++syncSeq}`;
    myTag.current = tag;
    fetch(`${SYNC_URL}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...snapshot, _tag: tag }),
      keepalive: true,
    }).catch(() => { /* relay down — stay local */ });
  }, [enabled, body]);
}

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
  const [locName, setLocName] = useState("Lokasi Kantor");
  const now = useClock();

  const loggedIn = !!token && !!me;
  const checkedIn = !!me?.today?.check_in;
  const checkedOut = !!me?.today?.check_out;
  const gpsOk = true;

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
      const r = await api.employeeLogin(loginId.trim().toUpperCase(), loginPin.trim());
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

  const doScan = (action: "in" | "out") => {
    if (!token) return;
    setScanning(true); setScanErr("");
    setTimeout(async () => {
      try {
        const loc = await api.publicLocation();
        if (action === "in") await api.meCheckin(token, { location_token: loc.token, lat: loc.lat, lng: loc.lng });
        else await api.meCheckout(token, { location_token: loc.token });
        setMe(await api.me(token));
        setScanDone(true);
        setTimeout(() => setScanDone(false), 2500);
      } catch (e: any) {
        setScanErr(e?.message || "Gagal memindai");
      } finally {
        setScanning(false);
      }
    }, 2000);
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="bg-[#1B3D72] px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Smartphone className="w-5 h-5 text-white/80" />
          <div>
            <p className="font-bold text-white text-sm">Aplikasi Karyawan</p>
            <p className="text-[10px] text-white/50 font-mono">PORT :5173 · Mode QR Lokasi</p>
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
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">ID Karyawan</label>
              <input value={loginId} onChange={e => setLoginId(e.target.value)}
                placeholder="EMP001"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-input-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-3 transition-all" />
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">PIN</label>
              <input value={loginPin} onChange={e => setLoginPin(e.target.value)} type="password"
                onKeyDown={e => e.key === "Enter" && doLogin()}
                placeholder="••••••"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-input-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-1 transition-all" />
              {loginErr && <p className="text-xs text-destructive mb-2">{loginErr}</p>}
              <p className="text-[11px] text-muted-foreground mt-2">Demo: ID EMP001–EMP008 · PIN 123456</p>
              <button onClick={doLogin} disabled={!loginId.trim() || !loginPin.trim() || busy}
                className="w-full mt-3 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                {busy ? "Memproses…" : <>Masuk <ArrowRight className="w-4 h-4" /></>}
              </button>
            </motion.div>
          </div>
        ) : employee ? (
          <div className="space-y-4">
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

              {/* Viewfinder */}
              <div className="relative w-full max-w-[220px] mx-auto aspect-square bg-foreground/5 rounded-2xl border-2 border-dashed border-border overflow-hidden flex items-center justify-center mb-4">
                {scanDone ? (
                  <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-16 h-16 text-accent" />
                    <p className="text-sm font-bold text-accent">{checkedIn && !checkedOut ? "Check-Out Berhasil" : "Check-In Berhasil"}</p>
                  </motion.div>
                ) : scanning ? (
                  <>
                    <Camera className="w-10 h-10 text-primary/20" />
                    <motion.div className="absolute left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
                      animate={{ y: [-70, 70, -70] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
                    <div className="absolute inset-0 bg-primary/5" />
                    <p className="absolute bottom-3 text-xs text-primary font-semibold">Memindai…</p>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Camera className="w-10 h-10 opacity-30" />
                    <p className="text-xs text-center opacity-60">Klik tombol untuk<br/>mengaktifkan kamera</p>
                  </div>
                )}

                {/* Corner marks */}
                {["top-2 left-2", "top-2 right-2", "bottom-2 left-2", "bottom-2 right-2"].map((p, i) => (
                  <div key={i} className={`absolute ${p} w-5 h-5 border-primary/50 border-2 ${i===0?"rounded-tl border-r-0 border-b-0":i===1?"rounded-tr border-l-0 border-b-0":i===2?"rounded-bl border-r-0 border-t-0":"rounded-br border-l-0 border-t-0"}`} />
                ))}
              </div>

              {/* GPS */}
              <div className={`flex items-center justify-center gap-2 text-xs font-semibold mb-4 ${gpsOk ? "text-emerald-600" : "text-red-500"}`}>
                <MapPin className="w-3.5 h-3.5" />
                {gpsOk ? `GPS: ${locName} ✓` : "GPS: Lokasi tidak dikenali"}
                <span className={`w-1.5 h-1.5 rounded-full ${gpsOk ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
              </div>

              {scanErr && (
                <div className="flex items-start gap-2 p-2.5 mb-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />{scanErr}
                </div>
              )}

              {/* Buttons */}
              {!checkedIn && !checkedOut && (
                <button onClick={() => doScan("in")} disabled={scanning || !gpsOk}
                  className="w-full py-3 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  <Camera className="w-4 h-4" />Pindai untuk Check-In
                </button>
              )}
              {checkedIn && !checkedOut && (
                <button onClick={() => doScan("out")} disabled={scanning || !gpsOk}
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

function QRLokasiControlPanel({ attendance, leaveRequests, onApproveLeave, onRejectLeave, employees, onCreateEmployee, onUpdateEmployee, onDeleteEmployee, onResetCode, qrVariant, setQrVariant, qrInterval, setQrInterval }: {
  attendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  onApproveLeave: (id: string) => void;
  onRejectLeave: (id: string) => void;
  employees: ApiEmployee[];
  onCreateEmployee: (b: EmployeeInput) => Promise<void>;
  onUpdateEmployee: (id: string, b: EmployeeInput) => Promise<void>;
  onDeleteEmployee: (id: string, soft?: boolean) => Promise<void>;
  onResetCode: (id: string) => Promise<void>;
  qrVariant: QRVariant; setQrVariant: (v: QRVariant) => void;
  qrInterval: number; setQrInterval: (n: number) => void;
}) {
  const now = useClock();
  const { timeLeft, qrUrl, staticUrl } = useDynamicQR(qrInterval);
  const [tab, setTab] = useState<"qr_display" | "kehadiran" | "izin_cuti" | "karyawan">("qr_display");

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
              <p className="text-[10px] text-white/40 font-mono">PORT :5174</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {[
            { key: "qr_display", label: "Tampilan QR", icon: <QrCode className="w-4 h-4" /> },
            { key: "kehadiran",  label: "Kehadiran",   icon: <Activity className="w-4 h-4" /> },
            { key: "izin_cuti",  label: "Izin & Cuti", icon: <FileText className="w-4 h-4" />, badge: leaveRequests.filter(l => l.status === "pending").length },
            { key: "karyawan",   label: "Karyawan",    icon: <UserCheck className="w-4 h-4" />, badge: employees.length },
          ].map(({ key, label, icon, badge }: any) => (
            <button key={key} onClick={() => setTab(key)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === key ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}>
              <span className="flex items-center gap-2">{icon}{label}</span>
              {badge ? <span className="bg-amber-400 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span> : null}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-white/10">
          <div className="flex items-center gap-1.5 text-[11px] text-white/50">
            <Wifi className="w-3 h-3 text-accent" />Tersinkronisasi
          </div>
          <p className="font-mono text-white/70 text-xs mt-0.5 tabular-nums">{fmtTime(now)}</p>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="bg-card border-b border-border px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="font-bold text-sm">
              {tab === "qr_display" ? "QR Code Lokasi Absensi" : tab === "kehadiran" ? "Rekap Kehadiran" : tab === "izin_cuti" ? "Manajemen Izin & Cuti" : "Kelola Karyawan"}
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
                  <p className="text-white/80 text-xs font-semibold uppercase tracking-widest">PT. Nusantara Digital</p>
                  <p className="text-white font-bold text-sm">Absensi Harian — Kantor Pusat</p>

                  <div className="relative bg-white rounded-xl p-3 shadow-lg">
                    <img src={qrVariant === "dynamic" ? qrUrl : staticUrl}
                      alt="QR Lokasi" width={160} height={160}
                      className="block rounded-sm" />
                    {qrVariant === "dynamic" && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                        <Zap className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>

                  {qrVariant === "dynamic" ? (
                    <div className="flex items-center gap-3">
                      <svg width={52} height={52} viewBox="0 0 52 52">
                        <circle cx={26} cy={26} r={22} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={4} />
                        <circle cx={26} cy={26} r={22} fill="none" stroke="#0EA472" strokeWidth={4}
                          strokeDasharray={`${dash} ${circum}`}
                          strokeLinecap="round"
                          style={{ transform: "rotate(-90deg)", transformOrigin: "center", transition: "stroke-dasharray 1s linear" }} />
                        <text x={26} y={30} textAnchor="middle" fill="white" fontSize={13} fontWeight={700} fontFamily="monospace">{timeLeft}</text>
                      </svg>
                      <div>
                        <p className="text-white text-xs font-semibold">Berganti dalam {timeLeft}d</p>
                        <p className="text-white/50 text-[10px]">Interval: {qrInterval >= 3600 ? `${qrInterval/3600} jam` : `${qrInterval/60} menit`}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-white/50 text-xs">Kode Statis — Tidak Berubah</p>
                  )}

                  <p className="text-white/40 text-[10px] font-mono">Pindai menggunakan aplikasi karyawan</p>
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
                      const emp = EMPLOYEES.find(e => e.id === rec.employeeId);
                      if (!emp) return null;
                      return (
                        <tr key={rec.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Avatar initials={emp.avatar} size="sm" />
                              <div>
                                <p className="font-semibold text-sm">{emp.name}</p>
                                <p className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${DEPT_COLORS[emp.department] ?? "bg-muted text-foreground"} inline-block`}>{emp.department}</p>
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
              {leaveRequests.map(req => {
                const emp = EMPLOYEES.find(e => e.id === req.employeeId);
                if (!emp) return null;
                return (
                  <div key={req.id} className="bg-card rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <Avatar initials={emp.avatar} />
                        <div>
                          <p className="font-bold text-sm">{emp.name}</p>
                          <p className="text-xs text-muted-foreground">{emp.position}</p>
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
  const EMPTY: EmployeeInput = { name: "", email: "", position: "", department: "", schedule_in: "08:00", schedule_out: "17:00" };
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
      schedule_in: e.schedule.in ?? "08:00", schedule_out: e.schedule.out ?? "17:00", status: e.status });
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
            {["Karyawan", "Departemen", "Jadwal", "Status", "Kode", "Aksi"].map(h => (
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
                <td className="px-4 py-2.5"><span className={`text-[11px] ${e.barcode ? "text-emerald-600" : "text-muted-foreground"}`}>{e.barcode ? "✓ ada" : "—"}</span></td>
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

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL 2 — Terminal Scan
// Port :5173 = Scanner terminal at entrance — reads employee's QR
// Port :5174 = Admin — standard dashboard
// ═══════════════════════════════════════════════════════════════════════════════

function TerminalScanKiosk({ attendance, onCheckIn, onCheckOut }: {
  attendance: AttendanceRecord[];
  onCheckIn: (empId: string) => void;
  onCheckOut: (empId: string) => void;
}) {
  const now = useClock();
  const [scanning, setScanning] = useState(false);
  const [identified, setIdentified] = useState<Employee | null>(null);
  const [action, setAction] = useState<"in" | "out" | null>(null);
  const [simEmpId, setSimEmpId] = useState("EMP001");

  const doScan = () => {
    const emp = EMPLOYEES.find(e => e.id === simEmpId);
    if (!emp) return;
    setScanning(true);
    setIdentified(null);
    setTimeout(() => {
      setScanning(false);
      setIdentified(emp);
      const rec = attendance.find(a => a.employeeId === emp.id);
      const act = rec?.checkIn && !rec?.checkOut ? "out" : "in";
      setAction(act);
      if (act === "in") onCheckIn(emp.id);
      else onCheckOut(emp.id);
      setTimeout(() => { setIdentified(null); setAction(null); }, 4000);
    }, 2000);
  };

  return (
    <div className="flex flex-col h-full bg-[#0D1B2A] text-white">
      {/* Kiosk Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <Monitor className="w-5 h-5 text-white/80" />
          </div>
          <div>
            <p className="font-bold text-white">Terminal Absensi</p>
            <p className="text-[10px] text-white/40 font-mono">PORT :5173 · Mode Scanner Terminal</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-2xl font-bold tabular-nums">{fmtTime(now)}</p>
          <p className="text-xs text-white/40">{fmtDate(now)}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        {identified ? (
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            className="flex flex-col items-center gap-5 text-center">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center ${action === "in" ? "bg-emerald-500/20" : "bg-sky-500/20"}`}>
              <CheckCircle2 className={`w-10 h-10 ${action === "in" ? "text-emerald-400" : "text-sky-400"}`} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${action === "in" ? "text-emerald-400" : "text-sky-400"}`}>
                {action === "in" ? "Selamat Datang!" : "Sampai Jumpa!"}
              </p>
              <p className="text-white text-xl font-semibold mt-1">{identified.name}</p>
              <p className="text-white/50 text-sm">{identified.position} — {identified.department}</p>
              <p className="text-white/40 text-xs font-mono mt-2">{identified.id} · {action === "in" ? "Check-In" : "Check-Out"} · {nowHHMM()}</p>
            </div>
            <div className="flex gap-3">
              <div className={`px-4 py-2 rounded-full text-sm font-semibold ${action === "in" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "bg-sky-500/20 text-sky-400 border border-sky-500/30"}`}>
                <MapPin className="w-3.5 h-3.5 inline mr-1" />Kantor Pusat Jakarta ✓
              </div>
            </div>
          </motion.div>
        ) : (
          <>
            {/* Scanner Viewfinder */}
            <div className="relative w-56 h-56 flex items-center justify-center">
              <div className="absolute inset-0 rounded-2xl border-2 border-white/20" />
              {["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"].map((p, i) => (
                <div key={i} className={`absolute ${p} w-8 h-8 border-white/60 border-2 ${i===0?"rounded-tl border-r-0 border-b-0":i===1?"rounded-tr border-l-0 border-b-0":i===2?"rounded-bl border-r-0 border-t-0":"rounded-br border-l-0 border-t-0"}`} />
              ))}

              {scanning ? (
                <>
                  <Scan className="w-12 h-12 text-white/20" />
                  <motion.div className="absolute left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-accent to-transparent"
                    animate={{ y: [-90, 90, -90] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
                  <div className="absolute inset-0 bg-accent/5 rounded-xl" />
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 text-white/30">
                  <Scan className="w-12 h-12" />
                  <p className="text-xs">Tunjukkan ID Card / QR</p>
                </div>
              )}
            </div>

            <div className="text-center">
              <p className="text-white/70 text-sm">
                {scanning ? "Memindai QR karyawan…" : "Siap memindai kartu ID karyawan"}
              </p>
            </div>

            {/* Simulation controls */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 w-full max-w-xs">
              <p className="text-[10px] text-white/30 uppercase tracking-widest mb-3 text-center">Simulasi — Pilih Karyawan</p>
              <select value={simEmpId} onChange={e => setSimEmpId(e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white text-sm rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-1 focus:ring-white/30">
                {EMPLOYEES.map(e => (
                  <option key={e.id} value={e.id} className="bg-[#0D1B2A]">{e.name} ({e.id})</option>
                ))}
              </select>
              <button onClick={doScan} disabled={scanning}
                className="w-full py-2.5 rounded-lg bg-accent text-white font-semibold text-sm hover:bg-accent/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                <Scan className="w-4 h-4" />
                {scanning ? "Memindai…" : "Simulasi Scan"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Bottom bar */}
      <div className="px-6 py-3 border-t border-white/10 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 text-xs text-white/30">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          Terhubung ke sistem kontrol (port :5174)
        </div>
        <p className="text-xs text-white/30 font-mono">PT. NUSANTARA DIGITAL</p>
      </div>
    </div>
  );
}

function TerminalControlDashboard({ attendance, leaveRequests, onApproveLeave, onRejectLeave }: {
  attendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  onApproveLeave: (id: string) => void;
  onRejectLeave: (id: string) => void;
}) {
  const now = useClock();
  const [tab, setTab] = useState<"kehadiran" | "izin_cuti" | "karyawan">("kehadiran");
  const [search, setSearch] = useState("");

  const stats = {
    hadir: attendance.filter(a => a.status === "hadir").length,
    terlambat: attendance.filter(a => a.status === "terlambat").length,
    izin: attendance.filter(a => a.status === "izin" || a.status === "cuti").length,
    tidakHadir: attendance.filter(a => a.status === "tidak_hadir").length,
  };

  const filtered = attendance.filter(a => {
    const emp = EMPLOYEES.find(e => e.id === a.employeeId);
    return !search || emp?.name.toLowerCase().includes(search.toLowerCase()) || emp?.department.toLowerCase().includes(search.toLowerCase());
  });

  const approve = onApproveLeave;
  const reject = onRejectLeave;
  const pending = leaveRequests.filter(l => l.status === "pending").length;

  return (
    <div className="flex h-full">
      <div className="w-52 bg-[#1B3D72] flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-white/70" />
            <div>
              <p className="font-bold text-white text-sm">Sistem Kontrol</p>
              <p className="text-[10px] text-white/40 font-mono">PORT :5174</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {[
            { key: "kehadiran", label: "Kehadiran", icon: <Activity className="w-4 h-4" />, badge: 0 },
            { key: "izin_cuti", label: "Izin & Cuti", icon: <FileText className="w-4 h-4" />, badge: pending },
            { key: "karyawan",  label: "Karyawan",   icon: <Users className="w-4 h-4" />, badge: 0 },
          ].map(({ key, label, icon, badge }) => (
            <button key={key} onClick={() => setTab(key as typeof tab)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === key ? "bg-white/20 text-white" : "text-white/60 hover:bg-white/10 hover:text-white"}`}>
              <span className="flex items-center gap-2">{icon}{label}</span>
              {badge > 0 && <span className="bg-amber-400 text-amber-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span>}
            </button>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-white/10">
          <div className="flex items-center gap-1.5 text-[11px] text-white/50"><Wifi className="w-3 h-3 text-accent" />Tersinkronisasi</div>
          <p className="font-mono text-white/70 text-xs mt-0.5 tabular-nums">{fmtTime(now)}</p>
        </div>
      </div>

      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="bg-card border-b border-border px-5 py-3 flex items-center justify-between flex-shrink-0">
          <div>
            <h1 className="font-bold text-sm">{tab === "kehadiran" ? "Rekap Kehadiran" : tab === "izin_cuti" ? "Manajemen Izin & Cuti" : "Data Karyawan"}</h1>
            <p className="text-xs text-muted-foreground">{fmtDate(now)}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Monitor className="w-3.5 h-3.5 text-sky-500" />
            <span>Terminal scan aktif di port :5173</span>
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
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
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari nama atau departemen…"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all" />
              </div>
              <div className="bg-card rounded-xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border bg-muted/30">
                    {["Karyawan", "Check-In", "Check-Out", "Status", "Metode"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map(rec => {
                      const emp = EMPLOYEES.find(e => e.id === rec.employeeId);
                      if (!emp) return null;
                      return (
                        <tr key={rec.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Avatar initials={emp.avatar} size="sm" />
                              <div>
                                <p className="font-semibold text-sm">{emp.name}</p>
                                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${DEPT_COLORS[emp.department] ?? "bg-muted"} inline-block`}>{emp.department}</span>
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

          {tab === "izin_cuti" && (
            <div className="space-y-3">
              {leaveRequests.map(req => {
                const emp = EMPLOYEES.find(e => e.id === req.employeeId);
                if (!emp) return null;
                return (
                  <div key={req.id} className="bg-card rounded-xl border border-border p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <Avatar initials={emp.avatar} />
                        <div>
                          <p className="font-bold text-sm">{emp.name}</p>
                          <p className="text-xs text-muted-foreground">{emp.position}</p>
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

          {tab === "karyawan" && (
            <div className="grid grid-cols-2 gap-3">
              {EMPLOYEES.map(emp => (
                <div key={emp.id} className="bg-card rounded-xl border border-border p-4 flex items-center gap-3 hover:shadow-sm transition-shadow">
                  <Avatar initials={emp.avatar} size="lg" />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold">{emp.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{emp.position}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${DEPT_COLORS[emp.department] ?? "bg-muted"}`}>{emp.department}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{emp.scheduleIn}–{emp.scheduleOut}</span>
                    </div>
                  </div>
                  <p className="font-mono text-xs text-primary font-semibold flex-shrink-0">{emp.id}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backend (REST API Zylora)
// Menggantikan mock state + relay SSE: login admin sekali, lalu polling backend
// sebagai sumber kebenaran (pengganti "real-time sync"). Semua mutasi —
// check-in/out & approve cuti — ditulis ke API lalu di-refresh.
// ═══════════════════════════════════════════════════════════════════════════════

const CONTROL_EMAIL = "kontrol@nusantara.co.id";
const CONTROL_PASSWORD = "kontrol1234";
const POLL_MS = 4000;

const coversToday = (start: string, end: string, today: string) => start <= today && end >= today;

// enabled=false untuk port app-karyawan (QR Lokasi :5173): port itu TIDAK boleh
// login sebagai admin — karyawan auth sendiri di QRLokasiEmployeeApp.
function useBackendData(enabled = true) {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<ApiEmployee[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const codeCache = useRef<Record<string, string>>({});

  // Petakan data backend → bentuk yang dipakai komponen view. Mencakup SEMUA
  // karyawan: pakai record presensi bila ada, lalu cuti yang disetujui untuk hari
  // ini, lalu default tidak_hadir — meniru INITIAL_ATTENDANCE prototipe.
  const refresh = useCallback(async () => {
    const t = tokenRef.current;
    if (!t) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [board, leaves, emps] = await Promise.all([api.attendance(t), api.leaves(t), api.employees(t)]);
      setEmployees(emps);
      const lr: LeaveRequest[] = leaves.map((l: ApiLeaveRow) => ({
        id: l.requestId, employeeId: l.employeeId,
        type: l.type === "cuti" ? "cuti" : "izin",
        startDate: l.start_date, endDate: l.end_date,
        reason: l.reason ?? "", status: l.status as LeaveRequest["status"],
      }));
      const approvedToday = lr.filter(l => l.status === "approved" && coversToday(l.startDate, l.endDate, today));
      const att: AttendanceRecord[] = EMPLOYEES.map(emp => {
        const row = board.find((r: ApiAttendanceRow) => r.employeeId === emp.id);
        if (row && (row.check_in || row.check_out)) {
          return {
            id: emp.id, employeeId: emp.id, date: today,
            checkIn: row.check_in, checkOut: row.check_out,
            status: row.status as AttendanceRecord["status"],
            location: "Kantor Pusat Jakarta",
            method: (row.method as AttendanceRecord["method"]) ?? "manual",
          };
        }
        const lv = approvedToday.find(l => l.employeeId === emp.id);
        if (lv) return {
          id: emp.id, employeeId: emp.id, date: today, checkIn: null, checkOut: null,
          status: lv.type, location: "—", method: "manual",
        };
        return {
          id: emp.id, employeeId: emp.id, date: today, checkIn: null, checkOut: null,
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

  // Login admin sekali, lalu polling berkala (hanya bila enabled).
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.controlLogin(CONTROL_EMAIL, CONTROL_PASSWORD)
      .then(r => { if (!alive) return; tokenRef.current = r.token; refresh(); })
      .catch(e => alive && setError(e?.message ?? String(e)));
    return () => { alive = false; };
  }, [enabled, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, refresh]);

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

  return {
    attendance, leaveRequests, employees, connected, error,
    checkIn, checkOut, approveLeave, rejectLeave,
    createEmployee, updateEmployee, deleteEmployee, resetEmployeeCode,
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
  const [loc, setLoc] = useState<ApiPublicLocation | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setLoc(await api.publicLocation()); setErr(null); }
    catch (e: any) { setErr(e?.message || "Gagal memuat QR"); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000); // refresh token dinamis berkala
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="h-screen w-screen bg-[#0D1B2A] text-white flex flex-col items-center justify-center p-8 relative" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="absolute top-6 left-8 flex items-center gap-2 text-white/60 text-sm">
        <Activity className="w-4 h-4 text-accent" />Zylora Absensi
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

      <div className="mt-6 flex items-center gap-2 text-sm">
        {loc?.type === "qr_dynamic" ? (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/15 text-accent border border-accent/30">
            <Zap className="w-4 h-4" />Kode dinamis — berganti otomatis
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
  // 2-port mode (VITE_ROLE set) locks this server to one port; the selector below
  // turns into a link to the other server. Single-port mode keeps the toggle.
  const twoPort = APP_ROLE === "employee" || APP_ROLE === "control";
  const fixedPort: "5173" | "5174" | null =
    APP_ROLE === "control" ? "5174" : APP_ROLE === "employee" ? "5173" : null;

  const [systemMode, setSystemMode] = useState<SystemMode>("qr_lokasi");
  const [activePort, setActivePort] = useState<"5173" | "5174">("5173");
  const [qrVariant, setQrVariant] = useState<QRVariant>("dynamic");
  const [qrInterval, setQrInterval] = useState(60);

  // In 2-port mode the port comes from the server identity, not a tab click.
  const effectivePort = fixedPort ?? activePort;
  // Port app-karyawan (QR Lokasi :5173): auth sebagai karyawan, jadi hook admin
  // dimatikan (tidak login admin di sini). Sisanya (dashboard, kiosk terminal)
  // pakai token admin/perangkat tepercaya.
  const isEmployeePhone = systemMode === "qr_lokasi" && effectivePort === "5173";
  // App #3: halaman tampilan barcode (kiosk layar di lokasi) — publik, tanpa login.
  const isDisplay = APP_ROLE === "display";

  // Sumber kebenaran: backend Zylora (REST API). Menggantikan mock state + relay SSE.
  // Hook admin nonaktif di app-karyawan & di halaman tampilan barcode.
  const { attendance, leaveRequests, employees, checkIn, checkOut, approveLeave, rejectLeave,
    createEmployee, updateEmployee, deleteEmployee, resetEmployeeCode } = useBackendData(!isEmployeePhone && !isDisplay);

  const handleCheckIn = useCallback((empId: string) => {
    checkIn(empId, systemMode === "qr_lokasi" ? "qr_lokasi" : "terminal");
  }, [checkIn, systemMode]);

  const handleCheckOut = useCallback((empId: string) => {
    checkOut(empId);
  }, [checkOut]);

  // App #3: halaman tampilan barcode = layar mandiri (tanpa tab/selector).
  if (isDisplay) return <QRDisplayPage />;

  // Build per-role (VITE_ROLE) = deployment NYATA (APK/desktop): tampilkan langsung
  // app-nya tanpa "chrome" peraga prototipe (selektor Model Sistem + tab :5173/:5174,
  // yang hanya relevan untuk demo single-screen). Pola sama seperti isDisplay.
  if (APP_ROLE === "employee") return <QRLokasiEmployeeApp />;
  if (APP_ROLE === "control") return (
    <div className="h-screen overflow-hidden bg-background" style={{ fontFamily: "var(--font-sans)" }}>
      <QRLokasiControlPanel attendance={attendance} leaveRequests={leaveRequests}
        onApproveLeave={approveLeave} onRejectLeave={rejectLeave}
        employees={employees} onCreateEmployee={createEmployee} onUpdateEmployee={updateEmployee}
        onDeleteEmployee={deleteEmployee} onResetCode={resetEmployeeCode}
        qrVariant={qrVariant} setQrVariant={setQrVariant} qrInterval={qrInterval} setQrInterval={setQrInterval} />
    </div>
  );

  const MODE_CFG = {
    qr_lokasi: {
      label: "QR Ditempel / Ditampilkan di Lokasi",
      desc: "Karyawan scan QR yang ada di lokasi menggunakan ponsel",
      port5173: { label: "Aplikasi Ponsel Karyawan", icon: <Smartphone className="w-3.5 h-3.5" /> },
      port5174: { label: "Sistem Kontrol + Tampilan QR Lokasi", icon: <Monitor className="w-3.5 h-3.5" /> },
      color: "text-violet-600",
      bg: "bg-violet-50 border-violet-200",
      dot: "bg-violet-500",
    },
    terminal_scan: {
      label: "Scanner / Terminal di Lokasi",
      desc: "Terminal membaca QR unik dari ID card / ponsel karyawan",
      port5173: { label: "Terminal Scanner (Kiosk)", icon: <Monitor className="w-3.5 h-3.5" /> },
      port5174: { label: "Sistem Kontrol", icon: <Shield className="w-3.5 h-3.5" /> },
      color: "text-sky-600",
      bg: "bg-sky-50 border-sky-200",
      dot: "bg-sky-500",
    },
  };

  const cfg = MODE_CFG[systemMode];

  return (
    <div className="h-screen flex flex-col bg-background" style={{ fontFamily: "var(--font-sans)" }}>
      {/* System Mode Selector */}
      <div className="bg-foreground text-background flex-shrink-0 flex items-center gap-0 px-4 py-2 text-xs">
        <span className="text-background/40 mr-3 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5 text-accent" />Model Sistem Absensi:</span>
        {(["qr_lokasi", "terminal_scan"] as SystemMode[]).map(m => (
          <button key={m} onClick={() => setSystemMode(m)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md mr-1.5 font-semibold transition-all ${systemMode === m ? "bg-white/15 text-white" : "text-background/40 hover:bg-white/8 hover:text-background/70"}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${MODE_CFG[m].dot}`} />
            {MODE_CFG[m].label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-background/30">
          <Wifi className="w-3 h-3 text-accent" />Dua port aktif dan tersinkronisasi
        </div>
      </div>

      {/* Port Tabs */}
      <div className="bg-card border-b border-border flex-shrink-0 flex items-center">
        {(["5173", "5174"] as const).map(port => {
          const info = port === "5173" ? cfg.port5173 : cfg.port5174;
          const isActive = effectivePort === port;
          return (
            <button key={port}
              title={twoPort && !isActive ? `Buka server :${port} di tab ini` : undefined}
              onClick={() => {
                if (twoPort) {
                  if (!isActive) window.location.href = `http://${window.location.hostname}:${port}/`;
                } else {
                  setActivePort(port);
                }
              }}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all ${isActive ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {info.icon}{info.label}
              <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>:{port}</span>
              {twoPort && !isActive && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
            </button>
          );
        })}
        <div className="flex-1 flex items-center justify-end px-5">
          <span className={`text-[11px] px-2.5 py-1 rounded-full border font-semibold ${cfg.bg} ${cfg.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} inline-block mr-1.5 animate-pulse`} />
            {systemMode === "qr_lokasi" ? "QR Lokasi" : "Terminal Scan"} — Data real-time tersinkronisasi
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {systemMode === "qr_lokasi" ? (
          effectivePort === "5173" ? (
            <QRLokasiEmployeeApp />
          ) : (
            <QRLokasiControlPanel attendance={attendance} leaveRequests={leaveRequests} onApproveLeave={approveLeave} onRejectLeave={rejectLeave}
              employees={employees} onCreateEmployee={createEmployee} onUpdateEmployee={updateEmployee}
              onDeleteEmployee={deleteEmployee} onResetCode={resetEmployeeCode}
              qrVariant={qrVariant} setQrVariant={setQrVariant} qrInterval={qrInterval} setQrInterval={setQrInterval} />
          )
        ) : (
          effectivePort === "5173" ? (
            <TerminalScanKiosk attendance={attendance} onCheckIn={handleCheckIn} onCheckOut={handleCheckOut} />
          ) : (
            <TerminalControlDashboard attendance={attendance} leaveRequests={leaveRequests} onApproveLeave={approveLeave} onRejectLeave={rejectLeave} />
          )
        )}
      </div>
    </div>
  );
}
