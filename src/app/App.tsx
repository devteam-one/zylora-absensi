import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { motion } from "motion/react";
import {
  QrCode, Users, Clock, CheckCircle2, LogOut, Shield,
  Calendar, MapPin, Search, Check, X, Scan, Bell,
  Building2, Timer, RefreshCw, FileText, BarChart2,
  UserCheck, UserX, Download, Activity, Wifi, WifiOff,
  Smartphone, Monitor, ArrowRight, ChevronRight,
  AlertTriangle, Eye, RotateCcw, Camera, Zap, Wallet, User,
  Maximize2, Minimize2, Pencil, Trash2
} from "lucide-react";
import { api, type ApiAttendanceRow, type ApiLeaveRow, type ApiMe, type ApiMeAttendance, type ApiMeLeave, type ApiMePayslip, type ApiPublicLocation, type ApiEmployee, type EmployeeInput, type ApiLocation, type LocationInput, type SalaryComponent, type PayrollRule, type PayrollRun, type Payslip, type ExchangeRate } from "./api";
import { Html5Qrcode } from "html5-qrcode";
import { Toaster, toast } from "sonner"; // notifikasi pop-up (framework UX)
import { z } from "zod"; // validasi form (skema)
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel } from "./components/ui/alert-dialog";

// --- Skema validasi form (zod) ---
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const optEmail = z.string().trim().email("Invalid email").or(z.literal(""));
export const employeeSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters"),
  email: optEmail.optional(),
  position: z.string().optional(),
  department: z.string().optional(),
  schedule_in: z.string().regex(TIME_RE, "Use HH:MM (24h)").optional().or(z.literal("")),
  schedule_out: z.string().regex(TIME_RE, "Use HH:MM (24h)").optional().or(z.literal("")),
  base_salary: z.coerce.number().min(0, "Cannot be negative"),
  password: z.string().optional(),
});
export const locationSchema = z.object({
  name: z.string().trim().min(2, "Location name is required"),
  radius_m: z.coerce.number().min(1, "Radius must be at least 1 m"),
});
export const shiftSchema = z.object({
  name: z.string().trim().min(1, "Shift name is required"),
  start: z.string().regex(TIME_RE, "Use HH:MM"),
  end: z.string().regex(TIME_RE, "Use HH:MM"),
});
export const salaryComponentSchema = z.object({
  name: z.string().trim().min(1, "Component name is required"),
  type: z.enum(["earning", "deduction"]),
  basis: z.enum(["fixed", "percent_base", "per_late_min", "per_absent_day", "per_overtime_hour"]),
  value: z.coerce.number().min(0, "Value cannot be negative"),
});
export const payrollRuleSchema = z.object({
  name: z.string().trim().min(1, "Rule name is required"),
  metric: z.enum(["late_days", "late_minutes", "overtime_hours", "absent_days", "leave_days"]),
  threshold: z.coerce.number().min(0, "Threshold cannot be negative"),
  action: z.enum(["bonus", "deduction"]),
  amount: z.coerce.number().min(0, "Amount cannot be negative"),
});
export const exchangeRateSchema = z.object({
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, "Use a 3-letter code (e.g. USD)"),
  rate: z.coerce.number().positive("Rate must be > 0"),
});
function zodErrors(err) {
  const out = {};
  for (const i of err.issues) { const k = String(i.path[0] ?? "_"); if (!out[k]) out[k] = i.message; }
  return out;
}

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
  hadir:       { label: "Present",       color: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  terlambat:   { label: "Late",   color: "bg-amber-100 text-amber-700 border-amber-200",   dot: "bg-amber-500" },
  izin:        { label: "Permission",        color: "bg-blue-100 text-blue-700 border-blue-200",       dot: "bg-blue-500" },
  cuti:        { label: "Leave",        color: "bg-purple-100 text-purple-700 border-purple-200", dot: "bg-purple-500" },
  tidak_hadir: { label: "Absent", color: "bg-red-100 text-red-700 border-red-200",         dot: "bg-red-500" },
};

const DEPT_COLORS: Record<string, string> = {
  "Teknologi Informasi": "bg-indigo-100 text-indigo-700",
  "Sumber Daya Manusia": "bg-pink-100 text-pink-700",
  "Keuangan":            "bg-amber-100 text-amber-700",
  "Marketing":           "bg-teal-100 text-teal-700",
  "Operasional":         "bg-orange-100 text-orange-700",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(d: Date) { return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
function fmtDate(d: Date) { return d.toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); }
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

// ─── Identitas versi (sumber tunggal: version.json, di-bake saat build) ────────
const env = (import.meta as any).env || {};
export const BUILD = {
  name: env.VITE_APP_NAME || "Zylora",
  product: env.VITE_APP_PRODUCT || "Zylora Absensi & HRIS",
  version: env.VITE_APP_VERSION || "0.0.0",
  channel: env.VITE_APP_CHANNEL || "dev",
  sha: env.VITE_BUILD_SHA || "local",
  code: String(env.VITE_VERSION_CODE || "0"),
  date: env.VITE_BUILD_DATE || "",
} as const;
// Label versi ringkas: v1.0.0 · a1b2c3d (· channel bila bukan stable).
export const VERSION_LABEL = `v${BUILD.version} · ${BUILD.sha}${BUILD.channel !== "stable" ? ` · ${BUILD.channel}` : ""}`;
function VersionTag({ className = "" }: { className?: string }) {
  const built = BUILD.date ? new Date(BUILD.date).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
  return <span className={className} title={`${BUILD.product}\nVersi ${BUILD.version} (build ${BUILD.code})\ncommit ${BUILD.sha}${built ? `\ndibangun ${built}` : ""}`}>{VERSION_LABEL}</span>;
}

// Tanggal LOKAL (zona browser, mis. WIB) — BUKAN UTC. toISOString() memakai UTC
// sehingga di sekitar tengah malam tanggalnya meleset dari backend (zona perusahaan).
const pad2 = (n: number) => String(n).padStart(2, "0");
const localYMD = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localYM = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

// ─── Skeleton loading (placeholder berdenyut saat memuat) ─────────────────────
function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-muted/70 rounded-lg ${className}`} />;
}
// Skeleton penuh Sistem Kontrol — tampil saat memulihkan sesi (cegah kedip login).
function ControlSkeleton() {
  return (
    <div className="h-screen flex bg-[#0D1B2A]" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="w-60 bg-card border-r border-border p-4 space-y-2.5">
        <Skeleton className="h-8 w-36 mb-5" />
        {Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
      <div className="flex-1 p-6 space-y-4">
        <Skeleton className="h-7 w-56" />
        <div className="grid grid-cols-4 gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-72 w-full" />
        <p className="text-center text-white/50 text-xs flex items-center justify-center gap-2"><RefreshCw className="w-3.5 h-3.5 animate-spin" />Restoring session…</p>
      </div>
    </div>
  );
}

// ─── Tabel paginasi konsisten (standar 12 baris/halaman, kontrol lengkap) ─────
const PAGE_SIZE = 12; // standar baris per halaman di SELURUH tabel (rekomendasi UX 10–25)
function usePagination<T>(items: T[], pageSize = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(cur * pageSize, total);
  const pageItems = items.slice((cur - 1) * pageSize, cur * pageSize);
  return { page: cur, setPage, total, totalPages, from, to, pageItems };
}
// Kontrol paginasi seragam: First/Prev/Next/Last (nonaktif di ujung, tidak disembunyikan)
// + indikator "Menampilkan X–Y dari Z data". Pakai di semua tabel agar konsisten.
function Pagination({ page, totalPages, total, from, to, onPage }: {
  page: number; totalPages: number; total: number; from: number; to: number; onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  const btn = "px-2.5 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
  return (
    <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
      <span className="text-xs text-muted-foreground">Showing <b className="text-foreground">{from}–{to}</b> of <b className="text-foreground">{total}</b></span>
      <div className="flex items-center gap-1">
        <button className={btn} disabled={page <= 1} onClick={() => onPage(1)} title="First page">« First</button>
        <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} title="Previous">‹ Prev</button>
        <span className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">Page {page}/{totalPages}</span>
        <button className={btn} disabled={page >= totalPages} onClick={() => onPage(page + 1)} title="Next">Next ›</button>
        <button className={btn} disabled={page >= totalPages} onClick={() => onPage(totalPages)} title="Last page">Last »</button>
      </div>
    </div>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AttendanceRecord["status"] }) {
  // Fallback agar status tak dikenal (mis. "alpa" dari DB) tidak meng-crash render.
  const c = STATUS_CFG[status] || { label: String(status), color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" };
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
  if (method === "qr_lokasi") return <span className="inline-flex items-center gap-1 text-[10px] text-violet-600 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full font-semibold"><QrCode className="w-2.5 h-2.5" />QR Location</span>;
  if (method === "terminal") return <span className="inline-flex items-center gap-1 text-[10px] text-sky-600 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-full font-semibold"><Monitor className="w-2.5 h-2.5" />Terminal</span>;
  return <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-semibold">Manual</span>;
}

// Konfirmasi aksi destruktif — SATU dialog dipakai ulang oleh semua tab kontrol
// (menggantikan konfirmasi inline per-tab + delete instan tanpa konfirmasi). Pakai:
//   const { ask, confirmNode } = useConfirm();
//   ...<button onClick={() => ask({ title: "Delete shift?", onConfirm: () => del(id) })} />
//   ...{confirmNode}   // render sekali di pohon tab
type ConfirmReq = { title: string; body?: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void | Promise<void> };
function useConfirm() {
  const [req, setReq] = useState<ConfirmReq | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useCallback((r: ConfirmReq) => setReq(r), []);
  const confirmNode = (
    <AlertDialog open={!!req} onOpenChange={(o) => { if (!o && !busy) setReq(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{req?.title ?? "Are you sure?"}</AlertDialogTitle>
          {req?.body && <AlertDialogDescription>{req.body}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={busy}
            onClick={async (e) => { e.preventDefault(); if (!req) return; setBusy(true); try { await req.onConfirm(); setReq(null); } catch (err: any) { toast.error(err?.message || "Action failed"); } finally { setBusy(false); } }}
            className={req?.danger === false ? "" : "bg-red-600 hover:bg-red-700"}>
            {busy ? "Working…" : (req?.confirmLabel ?? "Delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { ask, confirmNode };
}

// ─── Design system: primitif tampilan bersama (dipakai SEMUA tab kontrol) ─────
// Restyle in-place berbasis primitif ini → konsistensi global tanpa men-tweak
// tiap tab terpisah (yang justru sumber inkonsistensi).

// Kartu standar (permukaan konten).
function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`bg-card rounded-2xl border border-border ${className}`}>{children}</div>;
}

// Kartu ber-judul: header (ikon + judul + subjudul + aksi kanan) → konten.
function SectionCard({ title, subtitle, icon, action, className = "", bodyClassName = "p-4", children }: {
  title?: ReactNode; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode;
  className?: string; bodyClassName?: string; children: ReactNode;
}) {
  return (
    <Card className={`overflow-hidden ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2 min-w-0">
            {icon && <span className="text-primary flex-shrink-0">{icon}</span>}
            <div className="min-w-0">
              {title && <p className="font-semibold text-sm truncate">{title}</p>}
              {subtitle && <p className="text-[11px] text-muted-foreground truncate">{subtitle}</p>}
            </div>
          </div>
          {action && <div className="flex items-center gap-2 flex-shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </Card>
  );
}

// Judul seksi tab + subjudul + aksi (header kecil di atas konten tab).
function TabIntro({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 flex-wrap">
      <div>
        <h2 className="font-bold text-base leading-tight">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

// Empty-state seragam: ikon + judul + petunjuk + aksi opsional.
function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-4 gap-2">
      {icon && <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center text-muted-foreground mb-1">{icon}</div>}
      <p className="font-semibold text-sm">{title}</p>
      {hint && <p className="text-xs text-muted-foreground max-w-sm">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// Skeleton baris tabel saat memuat (lebar kolom bervariasi agar natural).
function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  const widths = ["w-1/3", "w-1/5", "w-1/4", "w-1/6", "w-1/4", "w-1/5"];
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, c) => <Skeleton key={c} className={`h-4 ${widths[c % widths.length]}`} />)}
        </div>
      ))}
    </div>
  );
}

// Kartu statistik/KPI seragam (dipakai Dashboard, Attendance, History, dll.).
function StatCard({ label, value, sub, tone = "text-foreground", bg = "bg-card border-border", icon }: {
  label: string; value: ReactNode; sub?: string; tone?: string; bg?: string; icon?: ReactNode;
}) {
  return (
    <div className={`rounded-2xl border p-3.5 ${bg}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
      </div>
      <p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone}`}>{value}</p>
      <p className="text-[10px] text-muted-foreground h-3 truncate">{sub ?? ""}</p>
    </div>
  );
}

// Tombol-ikon aksi seragam (edit/hapus/dll) — area klik & hover konsisten.
function IconButton({ icon, title, onClick, tone = "hover:text-primary", disabled = false }: {
  icon: ReactNode; title: string; onClick: () => void; tone?: string; disabled?: boolean;
}) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onClick={onClick}
      className={`p-1.5 rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-40 ${tone}`}>
      {icon}
    </button>
  );
}

// Kelas tombol seragam (primary/secondary/danger) — dipakai lewat className.
const btnPrimary = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors";
const btnGhost = "inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-border text-sm font-semibold hover:bg-muted/40 disabled:opacity-40 transition-colors";
const fieldInput = "px-3 py-2 rounded-xl border border-border text-sm bg-card focus:outline-none focus:ring-2 focus:ring-primary/30";

// Banner pesan seragam (error merah / info hijau-biru).
function ErrorBanner({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{children}</div>;
}
function InfoBanner({ children, tone = "emerald" }: { children: ReactNode; tone?: "emerald" | "blue" }) {
  const c = tone === "blue" ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-emerald-50 border-emerald-200 text-emerald-700";
  return <div className={`flex items-center gap-2 p-2.5 rounded-xl border text-xs ${c}`}><CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />{children}</div>;
}

// Field berlabel (label uppercase kecil di atas kontrol).
function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`flex flex-col ${className}`}><label className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">{label}</label>{children}</div>;
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
    if (!("geolocation" in navigator)) { reject(new Error("Device doesn't support GPS")); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.code === 1 ? "Location permission denied — enable GPS to check in" : "Failed to read GPS")),
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
        ? "Camera permission denied — enable the camera to scan QR"
        : (e?.message || "Could not open the camera"));
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
// ── Badge kecil generik untuk app karyawan (riwayat presensi & status izin) ──
const ATT_PILL: Record<string, { label: string; cls: string }> = {
  hadir:     { label: "Present",     cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  terlambat: { label: "Late", cls: "bg-amber-100 text-amber-700 border-amber-200" },
  izin:      { label: "Permission",      cls: "bg-blue-100 text-blue-700 border-blue-200" },
  cuti:      { label: "Leave",      cls: "bg-purple-100 text-purple-700 border-purple-200" },
  sakit:     { label: "Sick",     cls: "bg-orange-100 text-orange-700 border-orange-200" },
  alpa:      { label: "Absent",      cls: "bg-red-100 text-red-700 border-red-200" },
};
const LEAVE_PILL: Record<string, { label: string; cls: string }> = {
  pending:  { label: "Pending",  cls: "bg-amber-100 text-amber-700 border-amber-200" },
  approved: { label: "Approved", cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  rejected: { label: "Rejected",   cls: "bg-red-100 text-red-700 border-red-200" },
};
function Pill({ map, value }: { map: Record<string, { label: string; cls: string }>; value: string }) {
  const c = map[value] || { label: value, cls: "bg-muted text-muted-foreground border-border" };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border ${c.cls}`}>{c.label}</span>;
}
// "YYYY-MM-DD" → tanggal pendek en-US (Sen, 24 Jun). String tak valid dikembalikan apa adanya.
function fmtDateShort(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s + "T00:00:00");
  return isNaN(+d) ? s : d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}

function QRLokasiEmployeeApp() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<ApiMe | null>(null);
  const [loginId, setLoginId] = useState(() => { try { return localStorage.getItem("zylora.employee.id") || ""; } catch { return ""; } });
  const [loginPin, setLoginPin] = useState("");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [remember, setRemember] = useState(true); // "Ingat saya"
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanDone, setScanDone] = useState(false);
  const [scanErr, setScanErr] = useState("");
  const [scanFor, setScanFor] = useState<null | "in" | "out">(null);
  const scanForRef = useRef<null | "in" | "out">(null);
  const [locName, setLocName] = useState("Office Location");
  const now = useClock();

  // Navigasi bawah & aksi terakhir (untuk label sukses yang benar).
  const [tab, setTab] = useState<"absen" | "riwayat" | "gaji" | "izin" | "profil">("absen");
  const [lastAction, setLastAction] = useState<"in" | "out" | null>(null);
  // Data self-service (lazy-load saat tab dibuka; null = belum dimuat).
  const [history, setHistory] = useState<ApiMeAttendance[] | null>(null);
  const [leaves, setLeaves] = useState<ApiMeLeave[] | null>(null);
  const [payslips, setPayslips] = useState<ApiMePayslip[] | null>(null);
  const [listBusy, setListBusy] = useState(false);
  // Form pengajuan izin/cuti.
  const [lvType, setLvType] = useState("cuti");
  const [lvStart, setLvStart] = useState("");
  const [lvEnd, setLvEnd] = useState("");
  const [lvReason, setLvReason] = useState("");
  const [lvBusy, setLvBusy] = useState(false);
  const [lvErr, setLvErr] = useState("");
  const [lvOk, setLvOk] = useState("");

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
      const m = await api.me(r.token);
      setMe(m);
      // "Ingat saya": simpan token + ID agar sesi pulih & ID terisi otomatis.
      // Jika tidak, jangan simpan token (login hanya untuk sesi ini).
      try {
        if (remember) { localStorage.setItem("zylora.employee.token", r.token); localStorage.setItem("zylora.employee.id", loginId.trim()); }
        else { localStorage.removeItem("zylora.employee.token"); localStorage.removeItem("zylora.employee.id"); }
      } catch { /* abaikan */ }
      try { setLocName((await api.publicLocation({ company: m.companyId })).name); } catch { /* abaikan */ }
    } catch (e: any) {
      setLoginErr(e?.message || "Login failed");
    } finally { setBusy(false); }
  };

  const doLogout = async () => {
    if (token) { try { await api.employeeLogout(token); } catch { /* abaikan */ } }
    setToken(null); setMe(null); setLoginId(""); setLoginPin("");
    setTab("absen"); setHistory(null); setLeaves(null); setPayslips(null); setLastAction(null);
    try { localStorage.removeItem("zylora.employee.token"); } catch { /* abaikan */ }
  };

  // Muat riwayat / izin saat tab dibuka (sekali; null = belum dimuat).
  useEffect(() => {
    if (!token) return;
    if (tab === "riwayat" && history === null) {
      setListBusy(true);
      api.meAttendance(token).then(setHistory).catch(() => setHistory([])).finally(() => setListBusy(false));
    }
    if (tab === "izin" && leaves === null) {
      setListBusy(true);
      api.meLeaves(token).then(setLeaves).catch(() => setLeaves([])).finally(() => setListBusy(false));
    }
    if (tab === "gaji" && payslips === null) {
      setListBusy(true);
      api.mePayslips(token).then(setPayslips).catch(() => setPayslips([])).finally(() => setListBusy(false));
    }
  }, [tab, token, history, leaves, payslips]);

  // Poll ringan status karyawan (mis. perubahan jadwal / absen dari perangkat lain).
  // DIJEDA saat kamera/proses absen aktif agar tak mengganggu pemindaian.
  useEffect(() => {
    if (!token || scanFor || scanning) return;
    const id = setInterval(() => {
      api.me(token).then(setMe).catch(() => {});
      if (tab === "riwayat") api.meAttendance(token).then(setHistory).catch(() => {});
    }, 12000);
    return () => clearInterval(id);
  }, [token, scanFor, scanning, tab]);

  // Kirim pengajuan izin/cuti.
  const submitLeave = async () => {
    setLvErr(""); setLvOk("");
    if (!token) return;
    if (!lvStart || !lvEnd) { setLvErr("Start & end dates are required"); return; }
    if (lvEnd < lvStart) { setLvErr("End date can't be before start date"); return; }
    setLvBusy(true);
    try {
      await api.submitLeave(token, { type: lvType, start_date: lvStart, end_date: lvEnd, reason: lvReason.trim() || undefined });
      setLvOk("Request submitted, awaiting admin approval.");
      setLvStart(""); setLvEnd(""); setLvReason("");
      setLeaves(await api.meLeaves(token));
    } catch (e: any) {
      setLvErr(e?.message || "Failed to submit request");
    } finally { setLvBusy(false); }
  };

  // Pulihkan sesi karyawan dari token tersimpan saat refresh (validasi via /api/me).
  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("zylora.employee.token"); } catch { /* abaikan */ }
    if (!saved) return;
    api.me(saved)
      .then((m) => { setToken(saved); setMe(m); api.publicLocation({ company: m.companyId }).then(l => setLocName(l.name)).catch(() => {}); })
      .catch(() => { try { localStorage.removeItem("zylora.employee.token"); } catch { /* abaikan */ } });
  }, []);

  // Buka kamera untuk memindai QR lokasi (action disimpan di ref agar callback
  // scanner stabil & kamera tak restart tiap render).
  const openScan = (action: "in" | "out") => { scanForRef.current = action; setScanErr(""); setScanFor(action); };
  const cancelScan = () => { setScanFor(null); };

  // Dipanggil saat QR berhasil dibaca: ambil GPS asli lalu kirim ke backend.
  const handleDecoded = useCallback(async (scannedToken: string) => {
    const action = scanForRef.current;
    if (!token || !action) return;
    setScanFor(null); setScanning(true); setScanErr(""); setLastAction(action);
    try {
      const gps = await getDeviceGps();
      if (action === "in") await api.meCheckin(token, { location_token: scannedToken, lat: gps.lat, lng: gps.lng });
      else await api.meCheckout(token, { location_token: scannedToken, lat: gps.lat, lng: gps.lng });
      setMe(await api.me(token));
      setHistory(null); // riwayat berubah → muat ulang saat tab dibuka
      setScanDone(true);
      setTimeout(() => setScanDone(false), 2500);
    } catch (e: any) {
      setScanErr(e?.message || "Check-in failed");
    } finally {
      setScanning(false);
    }
  }, [token]);

  const handleScanErr = useCallback((msg: string) => { setScanFor(null); setScanErr(msg); }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      <Toaster richColors position="top-center" />
      <OfflineBanner />
      <UpdateBanner role="employee" />
      {/* Header */}
      <div className="bg-[#1B3D72] px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <Smartphone className="w-5 h-5 text-white/80" />
          <div>
            <p className="font-bold text-white text-sm">Zylora Attendance</p>
            <p className="text-[10px] text-white/50">Employee QR Attendance</p>
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
              <h2 className="font-bold text-lg mb-1">Sign in to the App</h2>
              <p className="text-sm text-muted-foreground mb-5">Use your employee ID to sign in, then scan the QR posted at the attendance location.</p>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">ID or Email</label>
              <input value={loginId} onChange={e => setLoginId(e.target.value)}
                placeholder="ID or email from admin"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-input-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-3 transition-all" />
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">PIN</label>
              <input value={loginPin} onChange={e => setLoginPin(e.target.value)} type="password"
                onKeyDown={e => e.key === "Enter" && doLogin()}
                placeholder="••••••"
                className="w-full px-4 py-2.5 rounded-xl border border-border bg-input-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary mb-1 transition-all" />
              {loginErr && <p className="text-xs text-destructive mb-2">{loginErr}</p>}
              <label className="flex items-center gap-2 text-xs text-muted-foreground mt-2 cursor-pointer select-none">
                <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-primary w-3.5 h-3.5" />
                Ingat saya di perangkat ini
              </label>
              <p className="text-[11px] text-muted-foreground mt-2">ID &amp; PIN are created by the admin in Control System → Employees.</p>
              <button onClick={doLogin} disabled={!loginId.trim() || !loginPin.trim() || busy}
                className="w-full mt-3 py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                {busy ? "Processing…" : <>Sign in <ArrowRight className="w-4 h-4" /></>}
              </button>
              <VersionTag className="block text-center font-mono text-[10px] text-muted-foreground/60 mt-4" />
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
              <button onClick={() => setConfirmLogout(true)}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                <LogOut className="w-3.5 h-3.5" />Keluar
              </button>
            </div>

            {/* ════ TAB: ABSEN (status + pemindai) ════ */}
            {tab === "absen" && <>
            {/* Status */}
            <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${checkedIn ? "bg-emerald-100" : "bg-muted"}`}>
                {checkedIn ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <Clock className="w-5 h-5 text-muted-foreground" />}
              </div>
              <div>
                <p className="font-semibold text-sm">
                  {checkedOut
                    ? `In ${rec?.checkIn ?? "—"} · Out ${me?.today?.check_out ?? "—"}`
                    : checkedIn ? `Check-in tercatat: ${rec?.checkIn}` : "Not checked in yet"}
                </p>
                <p className="text-xs text-muted-foreground">Schedule: {employee.scheduleIn} – {employee.scheduleOut}</p>
              </div>
              {rec && <div className="ml-auto"><StatusBadge status={rec.status} /></div>}
            </div>

            {/* Scanner Panel */}
            <div className="bg-card rounded-2xl border border-border p-5">
              <p className="text-sm font-semibold mb-1">Scan QR at Attendance Location</p>
              <p className="text-xs text-muted-foreground mb-4">Point your phone camera at the QR shown on screen / posted at the entrance.</p>

              {/* Viewfinder — kamera SUNGGUHAN saat memindai (responsif HP & tablet) */}
              <div className="relative w-full max-w-[240px] sm:max-w-[320px] md:max-w-[380px] mx-auto aspect-square bg-foreground/5 rounded-2xl border-2 border-dashed border-border overflow-hidden flex items-center justify-center mb-3">
                {scanDone ? (
                  <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-16 h-16 text-accent" />
                    <p className="text-sm font-bold text-accent">{lastAction === "out" ? "Check-Out Berhasil" : "Check-In Berhasil"}</p>
                  </motion.div>
                ) : scanFor ? (
                  <QrScanner onDecoded={handleDecoded} onError={handleScanErr} />
                ) : scanning ? (
                  <div className="flex flex-col items-center gap-2 text-primary">
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                      <Camera className="w-10 h-10" />
                    </motion.div>
                    <p className="text-xs font-semibold">Processing & checking GPS…</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Camera className="w-10 h-10 opacity-30" />
                    <p className="text-xs text-center opacity-60">Tap the button below to<br/>open camera &amp; scan QR</p>
                  </div>
                )}

                {/* Corner marks (disembunyikan saat kamera live) */}
                {!scanFor && ["top-2 left-2", "top-2 right-2", "bottom-2 left-2", "bottom-2 right-2"].map((p, i) => (
                  <div key={i} className={`absolute ${p} w-5 h-5 border-primary/50 border-2 ${i===0?"rounded-tl border-r-0 border-b-0":i===1?"rounded-tr border-l-0 border-b-0":i===2?"rounded-bl border-r-0 border-t-0":"rounded-br border-l-0 border-t-0"}`} />
                ))}
              </div>

              {scanFor && (
                <button onClick={cancelScan} className="w-full mb-3 py-2 rounded-lg border border-border text-sm font-semibold text-muted-foreground hover:bg-muted/40">Cancel</button>
              )}

              {/* GPS — koordinat HP diperiksa saat absen (validasi radius di server) */}
              <div className="flex items-center justify-center gap-2 text-xs font-semibold mb-4 text-muted-foreground text-center">
                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Location: {locName} · phone GPS checked on scan</span>
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
                  <Camera className="w-4 h-4" />Scan to Check-In
                </button>
              )}
              {!scanFor && checkedIn && !checkedOut && (
                <button onClick={() => openScan("out")} disabled={scanning}
                  className="w-full py-3 rounded-xl bg-foreground text-background font-semibold text-sm hover:bg-foreground/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
                  <LogOut className="w-4 h-4" />Scan to Check-Out
                </button>
              )}
              {checkedOut && (
                <div className="w-full py-3 rounded-xl bg-muted text-muted-foreground font-semibold text-sm flex items-center justify-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />Attendance complete
                </div>
              )}
            </div>
            </>}

            {/* ════ TAB: RIWAYAT KEHADIRAN ════ */}
            {tab === "riwayat" && (
              <div className="bg-card rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold">Attendance History</p>
                  <button onClick={() => setHistory(null)}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                    <RefreshCw className="w-3 h-3" />Muat ulang
                  </button>
                </div>
                {history && history.length > 0 && (() => {
                  const d = new Date();
                  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  const m = history.filter((r) => r.date.startsWith(ym));
                  const hadir = m.filter((r) => r.status === "hadir").length;
                  const telat = m.filter((r) => r.status === "terlambat").length;
                  return (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-center"><p className="text-lg font-bold text-emerald-700">{hadir}</p><p className="text-[10px] text-emerald-700/80">Present this mo</p></div>
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-center"><p className="text-lg font-bold text-amber-700">{telat}</p><p className="text-[10px] text-amber-700/80">Terlambat</p></div>
                      <div className="rounded-xl bg-muted/40 border border-border p-2.5 text-center"><p className="text-lg font-bold">{m.length}</p><p className="text-[10px] text-muted-foreground">Total days</p></div>
                    </div>
                  );
                })()}
                {listBusy && history === null ? (
                  <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>
                ) : history && history.length > 0 ? (
                  <div className="divide-y divide-border">
                    {history.map((r) => (
                      <div key={r.date} className="flex items-center gap-3 py-2.5">
                        <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">{fmtDateShort(r.date)}</p>
                          <p className="text-[11px] text-muted-foreground">In {r.check_in ?? "—"} · Out {r.check_out ?? "—"}{workDur(r.check_in, r.check_out)}</p>
                        </div>
                        <div className="ml-auto"><Pill map={ATT_PILL} value={r.status} /></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-8 text-center">No attendance history yet.</p>
                )}
              </div>
            )}

            {/* ════ TAB: IZIN / CUTI ════ */}
            {tab === "izin" && <>
              <div className="bg-card rounded-2xl border border-border p-4">
                <p className="text-sm font-semibold mb-3">Request Leave / Permission</p>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {["cuti", "izin", "sakit"].map((t) => (
                    <button key={t} onClick={() => setLvType(t)}
                      className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${lvType === t ? "bg-primary text-white border-primary" : "border-border text-muted-foreground hover:bg-muted/40"}`}>{({cuti:"Leave",izin:"Permission",sakit:"Sick"} as Record<string,string>)[t] || t}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">Start</label>
                    <input type="date" value={lvStart} onChange={(e) => setLvStart(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground uppercase block mb-1">End</label>
                    <input type="date" value={lvEnd} min={lvStart || undefined} onChange={(e) => setLvEnd(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-input-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                </div>
                <textarea value={lvReason} onChange={(e) => setLvReason(e.target.value)} rows={2} placeholder="Reason (optional)"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-input-background text-sm mb-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/20" />
                {lvErr && <p className="text-xs text-destructive mb-2 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{lvErr}</p>}
                {lvOk && <p className="text-xs text-emerald-600 mb-2 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />{lvOk}</p>}
                <button onClick={submitLeave} disabled={lvBusy || !lvStart || !lvEnd}
                  className="w-full py-2.5 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 disabled:opacity-40 flex items-center justify-center gap-2 transition-all">
                  <Check className="w-4 h-4" />{lvBusy ? "Sending…" : "Submit"}
                </button>
              </div>
              <div className="bg-card rounded-2xl border border-border p-4">
                <p className="text-sm font-semibold mb-3">My Requests</p>
                {listBusy && leaves === null ? (
                  <p className="text-xs text-muted-foreground py-6 text-center">Loading…</p>
                ) : leaves && leaves.length > 0 ? (
                  <div className="divide-y divide-border">
                    {leaves.map((l) => (
                      <div key={l.requestId} className="py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold capitalize">{l.type}</span>
                          <div className="ml-auto"><Pill map={LEAVE_PILL} value={l.status} /></div>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {fmtDateShort(l.start_date)} – {fmtDateShort(l.end_date)}{l.reason ? ` · ${l.reason}` : ""}
                        </p>
                        {l.notes && <p className="text-[11px] text-muted-foreground mt-0.5">Catatan admin: {l.notes}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-6 text-center">No requests yet.</p>
                )}
              </div>
            </>}

            {/* ════ TAB: GAJI (slip gaji milik sendiri, read-only) ════ */}
            {tab === "gaji" && (
              <div className="bg-card rounded-2xl border border-border p-4">
                <p className="text-sm font-semibold mb-3">My Payslips</p>
                {listBusy && payslips === null ? (
                  <p className="text-xs text-muted-foreground py-8 text-center">Loading…</p>
                ) : payslips && payslips.length > 0 ? (
                  <div className="space-y-3">
                    {payslips.map((p) => (
                      <div key={p.period} className="rounded-xl border border-border p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold">{p.period}</span>
                          <span className="text-sm font-bold text-primary">{fmtMoney(p.net, p.currency)}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-[11px]">
                          <div className="text-muted-foreground">Base<br /><span className="text-foreground font-mono">{fmtMoney(p.base_salary, p.currency)}</span></div>
                          <div className="text-muted-foreground">Allowance<br /><span className="text-emerald-600 font-mono">+{fmtMoney(p.earnings, p.currency)}</span></div>
                          <div className="text-muted-foreground">Deduction<br /><span className="text-red-600 font-mono">−{fmtMoney(p.deductions, p.currency)}</span></div>
                        </div>
                        {p.detail?.lines && p.detail.lines.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border space-y-0.5">
                            {p.detail.lines.map((l, i) => (
                              <div key={i} className={`flex justify-between text-[11px] ${l.type === "earning" ? "text-emerald-600" : "text-red-600"}`}>
                                <span>{l.name}</span><span className="font-mono">{l.type === "earning" ? "+" : "−"}{fmtMoney(l.amount, p.currency)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-8 text-center">No payslips yet. Payslips appear after the admin runs payroll.</p>
                )}
              </div>
            )}

            {/* ════ TAB: PROFIL (data diri + kode personal) ════ */}
            {tab === "profil" && (
              <div className="space-y-4">
                <div className="bg-card rounded-2xl border border-border p-6 flex flex-col items-center text-center">
                  <Avatar initials={employee.avatar} size="lg" />
                  <p className="font-bold text-base mt-3">{employee.name}</p>
                  <p className="text-xs text-muted-foreground">{employee.position || "Employee"}{me?.department ? ` · ${me.department}` : ""}</p>
                </div>
                <div className="bg-card rounded-2xl border border-border p-4 text-sm">
                  {([
                    ["Employee ID", employee.id],
                    ["Department", me?.department || "—"],
                    ["Email", me?.email || "—"],
                    ["Schedule", `${employee.scheduleIn} – ${employee.scheduleOut}`],
                    ["Join Date", me?.start_date ? fmtDateShort(me.start_date) : "—"],
                  ] as const).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1.5 border-b border-border last:border-0">
                      <span className="text-muted-foreground">{k}</span><span className="font-semibold text-right">{v}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-card rounded-2xl border border-border p-6 flex flex-col items-center text-center">
                  <p className="text-sm font-semibold mb-2">Kode Personal</p>
                  {me?.codeImageUrl ? (
                    <img src={me.codeImageUrl} alt="Kode QR personal" className="w-40 h-40 rounded-xl border border-border bg-white object-contain" />
                  ) : (
                    <div className="w-40 h-40 rounded-xl border border-dashed border-border flex items-center justify-center text-muted-foreground"><QrCode className="w-10 h-10 opacity-30" /></div>
                  )}
                  {me?.code && <p className="text-[11px] font-mono text-muted-foreground mt-3 break-all px-4">{me.code}</p>}
                  <button onClick={() => setConfirmLogout(true)} className="mt-4 text-xs text-red-600 font-semibold flex items-center gap-1"><LogOut className="w-3.5 h-3.5" />Sign out</button>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* ════ Navigasi bawah (hanya saat login) ════ */}
      {loggedIn && employee && (
        <div className="flex-shrink-0 border-t border-border bg-card grid grid-cols-5">
          {([["absen", "Check-in", Scan], ["riwayat", "History", Calendar], ["gaji", "Salary", Wallet], ["izin", "Leave", FileText], ["profil", "Profile", User]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition-colors ${tab === key ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon className="w-5 h-5" />{label}
            </button>
          ))}
        </div>
      )}
      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>You'll need to sign in again with your ID & PIN to check in.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => doLogout()} className="bg-red-600 hover:bg-red-700">Yes, sign out</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Login admin Sistem Kontrol. Registrasi mandiri DIHAPUS (pengerasan keamanan):
// akun admin hanya dibuat operator via shell server (`tools/register-admin.mjs`).
function ControlLogin({ onLogin }: { onLogin: (email: string, password: string, remember?: boolean) => Promise<void> }) {
  const [email, setEmail] = useState(() => { try { return localStorage.getItem("zylora.control.email") || ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    if (!email.trim() || !password) { setErr("Email & password are required"); return; }
    setBusy(true); setErr("");
    try {
      await onLogin(email, password, remember);
    } catch (e: any) { setErr(e?.message || "Sign-in failed"); setBusy(false); }
  };
  const inputCls = "w-full px-3 py-2 rounded-lg border border-border text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-primary/30";
  return (
    <div className="h-screen flex items-center justify-center bg-[#0D1B2A] p-4" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="bg-card rounded-2xl border border-border p-7 w-full max-w-sm shadow-lg">
        <div className="w-12 h-12 rounded-xl bg-[#1B3D72] flex items-center justify-center mb-5"><Shield className="w-6 h-6 text-white" /></div>
        <h2 className="font-bold text-lg mb-1">Sign in to Control System</h2>
        <p className="text-sm text-muted-foreground mb-5">Admin login to manage attendance.</p>
        {err && <div className="flex items-center gap-2 p-2.5 mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />{err}</div>}
        <input className={inputCls} type="email" placeholder="Admin email" value={email} onChange={e => setEmail(e.target.value)} />
        <input className={inputCls} type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
        <label className="flex items-center gap-2 text-xs text-muted-foreground mb-3 cursor-pointer select-none">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} className="accent-[#1B3D72] w-3.5 h-3.5" />
          Remember me on this device
        </label>
        <button disabled={busy} onClick={submit} className="w-full mt-1 py-3 rounded-xl bg-[#1B3D72] text-white font-semibold text-sm hover:opacity-90 disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
        <p className="text-[11px] text-muted-foreground mt-4 text-center leading-relaxed">Account registration is handled by the system operator. Contact your administrator to create a new account.</p>
      </div>
    </div>
  );
}

function QRLokasiControlPanel({ attendance, leaveRequests, onApproveLeave, onRejectLeave, onDeleteLeave, employees, onCreateEmployee, onUpdateEmployee, onDeleteEmployee, onResetCode, authed, onLogin, onLogout, token, connected, locations, onCreateLocation, onUpdateLocation, onDeleteLocation, qrVariant, setQrVariant, qrInterval, setQrInterval }: {
  attendance: AttendanceRecord[];
  leaveRequests: LeaveRequest[];
  onApproveLeave: (id: string) => void;
  onRejectLeave: (id: string) => void;
  onDeleteLeave: (id: string) => Promise<void>;
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
  onUpdateLocation: (id: string, b: LocationInput) => Promise<void>;
  onDeleteLocation: (id: string) => Promise<void>;
  qrVariant: QRVariant; setQrVariant: (v: QRVariant) => void;
  qrInterval: number; setQrInterval: (n: number) => void;
}) {
  const now = useClock();
  const online = useOnline();
  const empName = useCallback((id: string) => employees.find(e => e.employeeId === id), [employees]);
  const initials = (name: string) => name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const { timeLeft, qrUrl, staticUrl } = useDynamicQR(qrInterval);
  const [tab, setTab] = useState<"dashboard" | "qr_display" | "kehadiran" | "izin_cuti" | "karyawan" | "lokasi" | "shift" | "perangkat" | "riwayat" | "penggajian" | "kurs" | "pengaturan" | "log">("dashboard");
  const [confirmLogout, setConfirmLogout] = useState(false);
  const { ask, confirmNode } = useConfirm(); // konfirmasi hapus (leave) — dialog bersama
  const leavePg = usePagination(leaveRequests); // paginasi tabel Izin & Cuti (12/hal)
  // Data ASLI dari server untuk pratinjau QR (bukan hardcoded/client-side).
  const [companyName, setCompanyName] = useState("");
  const [pubLoc, setPubLoc] = useState<ApiPublicLocation | null>(null);
  useEffect(() => {
    if (!authed || !token) return;
    let alive = true;
    const tick = () => {
      // Pratinjau QR di-scope ke perusahaan admin yang login (multi-tenant).
      api.company(token).then(c => {
        if (!alive) return;
        setCompanyName(c.name);
        api.publicLocation({ company: c.companyId }).then(p => alive && setPubLoc(p)).catch(() => alive && setPubLoc(null));
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [authed, token]);

  // Belum login → layar login admin (ganti auto-login demo). Setelah semua hooks
  // agar tidak melanggar rules-of-hooks.
  if (!authed) return <ControlLogin onLogin={onLogin} />;

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
              <p className="font-bold text-white text-sm">Control System</p>
              <p className="text-[10px] text-white/40">Admin Panel · Desktop</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {[
            { key: "dashboard",  label: "Dashboard",   icon: <BarChart2 className="w-4 h-4" /> },
            { key: "qr_display", label: "QR Display",  icon: <QrCode className="w-4 h-4" /> },
            { key: "kehadiran",  label: "Attendance",  icon: <Activity className="w-4 h-4" /> },
            { key: "izin_cuti",  label: "Leave",       icon: <FileText className="w-4 h-4" />, badge: leaveRequests.filter(l => l.status === "pending").length },
            { key: "karyawan",   label: "Employees",   icon: <UserCheck className="w-4 h-4" />, badge: employees.length },
            { key: "lokasi",     label: "Locations & QR", icon: <MapPin className="w-4 h-4" />, badge: locations.length },
            { key: "shift",      label: "Shifts",      icon: <Timer className="w-4 h-4" /> },
            { key: "perangkat",  label: "Devices",     icon: <Smartphone className="w-4 h-4" /> },
            { key: "riwayat",    label: "History",     icon: <Calendar className="w-4 h-4" /> },
            { key: "penggajian", label: "Payroll",     icon: <Download className="w-4 h-4" /> },
            { key: "kurs",       label: "Exchange Rates", icon: <RotateCcw className="w-4 h-4" /> },
            { key: "pengaturan", label: "Settings",    icon: <Building2 className="w-4 h-4" /> },
            { key: "log",        label: "Audit Log",   icon: <BarChart2 className="w-4 h-4" /> },
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
            {connected ? "Connected to server" : online ? "Server unreachable" : "No internet"}
          </div>
          <p className="font-mono text-white/70 text-xs mt-0.5 tabular-nums">{fmtTime(now)}</p>
          <VersionTag className="block font-mono text-[10px] text-white/30 mb-2" />
          <button onClick={() => setConfirmLogout(true)} className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white/70 bg-white/10 hover:bg-white/20 transition-colors">
            <LogOut className="w-3.5 h-3.5" />Sign out
          </button>
        </div>
        <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out of Control System?</AlertDialogTitle>
              <AlertDialogDescription>Your admin session will end. You'll need to sign in again to manage attendance.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onLogout()} className="bg-red-600 hover:bg-red-700">Yes, sign out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {confirmNode}
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="bg-card border-b border-border px-5 py-2.5 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" />{fmtDate(now)}</p>
          <span className="text-[11px] text-muted-foreground font-mono tabular-nums flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{fmtTime(now)}</span>
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">

          {/* Dashboard Tab */}
          {tab === "dashboard" && (
            <DashboardTab token={token!} onNav={(t) => setTab(t as typeof tab)} />
          )}

          {/* QR Display Tab */}
          {tab === "qr_display" && (
            <div className="space-y-4">
              <TabIntro title="Location Attendance QR" subtitle="Configure & preview the entrance QR employees scan to check in" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Settings */}
              <div className="bg-card rounded-xl border border-border p-5 space-y-4">
                <p className="font-semibold text-sm">Location QR Settings</p>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Code Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { v: "static", label: "Static", desc: "Permanent, print once", icon: <QrCode className="w-4 h-4" /> },
                      { v: "dynamic", label: "Dynamic", desc: "Rotates periodically, safer", icon: <Zap className="w-4 h-4" /> },
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
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Rotation Interval</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { v: 60, label: "1 Minute" },
                        { v: 300, label: "5 Minutes" },
                        { v: 3600, label: "1 Hour" },
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
                    <p className="text-xs text-amber-700">A static code can be misused if photographed and used from outside the location. Consider a dynamic QR + GPS verification.</p>
                  </div>
                )}

                {qrVariant === "dynamic" && (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-emerald-700">A dynamic code is safer because it's only valid for the set interval. Recommended for display on an entrance monitor.</p>
                  </div>
                )}
              </div>

              {/* QR Preview — "what's shown at entrance" */}
              <div className="bg-card rounded-xl border border-border p-5 flex flex-col items-center gap-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground self-start">
                  <Monitor className="w-3.5 h-3.5" />
                  <span>Entrance display preview</span>
                </div>

                <div className="bg-[#1B3D72] rounded-2xl p-5 w-full flex flex-col items-center gap-3">
                  <p className="text-white/80 text-xs font-semibold uppercase tracking-widest">{companyName || "—"}</p>
                  <p className="text-white font-bold text-sm">{pubLoc?.name || "No active location/QR"}</p>

                  {pubLoc?.qrImageUrl ? (
                    <div className="relative bg-white rounded-xl p-3 shadow-lg">
                      <img src={pubLoc.qrImageUrl} alt="Location QR" width={160} height={160} className="block rounded-sm" />
                      {pubLoc.type === "qr_dynamic" && (
                        <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-primary flex items-center justify-center"><Zap className="w-3 h-3 text-white" /></div>
                      )}
                    </div>
                  ) : (
                    <div className="w-[160px] h-[160px] bg-white/10 rounded-xl flex items-center justify-center text-white/40 text-[11px] text-center p-4">Create a QR first in the<br/>"Locations & QR" tab</div>
                  )}

                  {pubLoc?.type === "qr_dynamic" && pubLoc.serial != null ? (
                    <p className="text-white text-xs font-semibold">Serial #{pubLoc.serial} · single-use</p>
                  ) : pubLoc?.type === "qr_static" ? (
                    <p className="text-white/50 text-xs">Static code — fixed</p>
                  ) : null}

                  <p className="text-white/40 text-[10px] font-mono">Synced live from the server · scan with the employee app</p>
                </div>
              </div>
            </div>
            </div>
          )}

          {/* Attendance Tab */}
          {tab === "kehadiran" && (
            <RekapKehadiranTab token={token!} attendance={attendance} employees={employees} />
          )}

          {/* Leave Tab */}
          {tab === "izin_cuti" && (
            <div className="space-y-4">
              <TabIntro title="Leave Management" subtitle="Review, approve, reject or remove employee leave & permission requests" />
              {leaveRequests.length === 0 && (
                <Card><EmptyState icon={<FileText className="w-5 h-5" />} title="No leave requests" hint="Pending & processed leave/permission requests from employees appear here." /></Card>
              )}
              {leavePg.pageItems.map(req => {
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
                            <span className={`text-xs px-2 py-0.5 rounded-full font-semibold border ${req.type === "cuti" ? "bg-purple-100 text-purple-700 border-purple-200" : "bg-blue-100 text-blue-700 border-blue-200"}`}>{req.type === "cuti" ? "Leave" : "Permission"}</span>
                            <span className="text-xs text-muted-foreground font-mono">{req.startDate === req.endDate ? req.startDate : `${req.startDate} – ${req.endDate}`}</span>
                          </div>
                          <p className="text-sm mt-1.5 italic text-muted-foreground">&ldquo;{req.reason}&rdquo;</p>
                        </div>
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2">
                        {req.status === "pending" ? (
                          <div className="flex gap-2">
                            <button onClick={() => approve(req.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition-colors"><Check className="w-3.5 h-3.5" />Approve</button>
                            <button onClick={() => reject(req.id)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-700 border border-red-200 text-xs font-semibold hover:bg-red-100 transition-colors"><X className="w-3.5 h-3.5" />Reject</button>
                          </div>
                        ) : (
                          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${req.status === "approved" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-red-100 text-red-700 border-red-200"}`}>{req.status === "approved" ? "Approved" : "Rejected"}</span>
                        )}
                        <button title="Delete request"
                          onClick={() => ask({ title: "Delete leave request?", body: `Permanently remove ${nm}'s ${req.type === "cuti" ? "leave" : "permission"} request? This cannot be undone.`, onConfirm: () => onDeleteLeave(req.id) })}
                          className="text-muted-foreground hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
              <Pagination page={leavePg.page} totalPages={leavePg.totalPages} total={leavePg.total} from={leavePg.from} to={leavePg.to} onPage={leavePg.setPage} />
            </div>
          )}

          {/* Karyawan Tab */}
          {tab === "karyawan" && (
            <EmployeeManagerTab employees={employees} onCreate={onCreateEmployee}
              onUpdate={onUpdateEmployee} onDelete={onDeleteEmployee} onResetCode={onResetCode} />
          )}

          {/* Lokasi Tab */}
          {tab === "lokasi" && (
            <LokasiTab token={token!} locations={locations} onCreate={onCreateLocation} onUpdate={onUpdateLocation} onDelete={onDeleteLocation} />
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
  const { ask, confirmNode } = useConfirm();
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  // Search + pagination (client-side; data karyawan sudah dimuat penuh).
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const q = search.trim().toLowerCase();
  const filtered = employees.filter(e => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (!q) return true;
    return e.name.toLowerCase().includes(q)
      || (e.employeeId || "").toLowerCase().includes(q)
      || (e.position || "").toLowerCase().includes(q)
      || (e.department || "").toLowerCase().includes(q)
      || (e.email || "").toLowerCase().includes(q);
  });
  const { page: curPage, setPage, totalPages, total, from, to, pageItems } = usePagination(filtered);

  const openAdd = () => { setEditId(null); setForm(EMPTY); setErr(""); setMode("form"); };
  const openEdit = (e: ApiEmployee) => {
    setEditId(e.employeeId);
    setForm({ name: e.name, email: e.email ?? "", position: e.position ?? "", department: e.department ?? "",
      schedule_in: e.schedule.in ?? "08:00", schedule_out: e.schedule.out ?? "17:00", status: e.status, password: "", base_salary: e.base_salary ?? 0 });
    setErr(""); setMode("form");
  };
  const save = async () => {
    const parsed = employeeSchema.safeParse(form);
    if (!parsed.success) { setFieldErr(zodErrors(parsed.error)); setErr("Please fix the highlighted fields."); return; }
    setFieldErr({}); setBusy(true); setErr("");
    try {
      if (editId) await onUpdate(editId, form); else await onCreate(form);
      setMode("list");
    } catch (e: any) { setErr(e?.message || "Failed to save"); }
    finally { setBusy(false); }
  };
  const doDelete = (e: ApiEmployee) => ask({
    title: "Delete employee?",
    body: `Permanently delete ${e.name} (${e.employeeId})? Their attendance history and code will be removed. This cannot be undone.`,
    confirmLabel: "Delete",
    onConfirm: () => onDelete(e.employeeId, false), // error → toast via useConfirm
  });
  const doReset = async (id: string) => {
    setBusy(true); setErr("");
    try { await onResetCode(id); } catch (e: any) { setErr(e?.message || "Failed to reset code"); }
    finally { setBusy(false); }
  };
  // Bulk import CSV — parse di klien lalu pakai createEmployee per baris (logika teruji).
  const [importMsg, setImportMsg] = useState("");
  const downloadTemplate = () => downloadText("template-karyawan.csv", toCsv(
    ["name", "email", "position", "department", "schedule_in", "schedule_out", "base_salary", "pin"],
    [["Budi Santoso", "budi@perusahaan.id", "Staff IT", "Teknologi", "08:00", "17:00", "5000000", "123456"]]));
  const handleImport = async (file: File | null) => {
    if (!file) return;
    setImportMsg(""); setErr("");
    let rows: string[][];
    try { rows = parseCsvRows(await file.text()); } catch { setErr("Failed to read CSV file"); return; }
    if (rows.length < 2) { setErr("CSV has no data rows (needs a header + at least 1 row)."); return; }
    const header = rows[0].map(h => h.trim().toLowerCase());
    const col = (k: string) => header.indexOf(k);
    if (col("name") < 0) { setErr('CSV must have a "name" column. Download the template for reference.'); return; }
    let ok = 0, gagal = 0; const errs: string[] = [];
    setBusy(true);
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const g = (k: string) => { const j = col(k); return j >= 0 ? (r[j] ?? "").trim() : ""; };
      const name = g("name");
      if (!name) { gagal++; continue; }
      try {
        await onCreate({ name, email: g("email"), position: g("position"), department: g("department"),
          schedule_in: g("schedule_in") || "08:00", schedule_out: g("schedule_out") || "17:00",
          password: g("pin") || g("password"), base_salary: Number(g("base_salary")) || 0 });
        ok++;
      } catch (e: any) { gagal++; if (errs.length < 3) errs.push(`${name}: ${e?.message || "failed"}`); }
    }
    setBusy(false);
    setImportMsg(`Import done: ${ok} succeeded${gagal ? `, ${gagal} failed` : ""}.${errs.length ? " — " + errs.join("; ") : ""}`);
  };

  const field = (label: string, key: keyof EmployeeInput, type = "text", placeholder = "") => (
    <div>
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1">{label}</label>
      <input type={type} value={(form[key] as string) ?? ""} placeholder={placeholder}
        onChange={e => { setForm(f => ({ ...f, [key]: e.target.value })); if (fieldErr[key]) setFieldErr(fe => { const n = { ...fe }; delete n[key]; return n; }); }}
        className={`w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 ${fieldErr[key] ? "border-red-400 focus:ring-red-200" : "border-border focus:ring-primary/30"}`} />
      {fieldErr[key] && <p className="text-[11px] text-red-600 mt-1">{fieldErr[key]}</p>}
    </div>
  );

  if (mode === "form") return (
    <div className="space-y-4 max-w-2xl">
      <TabIntro title={editId ? "Edit Employee" : "Add Employee"} subtitle="Identity, schedule, base salary & login PIN" />
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <SectionCard title="Employee details" icon={<UserCheck className="w-4 h-4" />} bodyClassName="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {field("Name", "name", "text", "Full name")}
          {field("Email", "email", "email", "name@company.com")}
          {field("Position", "position", "text", "e.g. IT Staff")}
          {field("Department", "department", "text", "e.g. Information Technology")}
          {field("Clock-in", "schedule_in", "time")}
          {field("Clock-out", "schedule_out", "time")}
        </div>
        <Field label="Base Salary"><input type="number" value={form.base_salary ?? 0} placeholder="e.g. 5000000" onChange={e => setForm(f => ({ ...f, base_salary: Number(e.target.value) || 0 }))} className={fieldInput + " w-full"} /></Field>
        <Field label="Employee Login PIN / Password">
          <input type="text" value={form.password ?? ""} placeholder={editId ? "Leave blank to keep current" : "e.g. 123456 — for the employee app login"} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className={fieldInput + " w-full"} />
          <p className="text-[11px] text-muted-foreground mt-1">{editId ? "Fill in to change the employee's PIN." : "Without a PIN, the employee can't sign in or check attendance."}</p>
        </Field>
        {editId && (
          <Field label="Status"><select value={form.status ?? "active"} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className={fieldInput + " w-full"}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
        )}
        <div className="flex gap-2 pt-1">
          <button disabled={busy} onClick={save} className={btnPrimary}><Check className="w-4 h-4" />{busy ? "Saving…" : "Save"}</button>
          <button disabled={busy} onClick={() => setMode("list")} className={btnGhost}>Cancel</button>
        </div>
      </SectionCard>
    </div>
  );

  return (
    <div className="space-y-4">
      <TabIntro title="Manage Employees" subtitle={`${filtered.length} of ${employees.length} employees${q || statusFilter !== "all" ? " (filtered)" : ""}`}
        action={<>
          <button onClick={downloadTemplate} className="text-xs font-semibold text-primary hover:underline">CSV Template</button>
          <label className={btnGhost + " cursor-pointer"}><Download className="w-4 h-4 rotate-180" />Import CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={e => { handleImport(e.target.files?.[0] || null); e.currentTarget.value = ""; }} /></label>
          <button onClick={openAdd} className={btnPrimary}><UserCheck className="w-4 h-4" />Add Employee</button>
        </>} />
      {importMsg && <InfoBanner tone="blue">{importMsg}</InfoBanner>}
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search name, ID, position, department, email…" className={fieldInput + " w-full pl-9"} />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value as any); setPage(1); }} className={fieldInput}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>
      <SectionCard title="Employees" subtitle={`${filtered.length} shown`} bodyClassName="p-0">
        {filtered.length === 0 ? (
          <EmptyState icon={<Users className="w-5 h-5" />} title={employees.length === 0 ? "No employees yet" : "No matches"} hint={employees.length === 0 ? 'Click "Add Employee" or import a CSV to get started.' : "No employees match your search/filter."} />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/20">
              {["Employee", "Department", "Schedule", "Status", "QR / PIN", "Actions"].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {pageItems.map(e => (
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
                  <td className="px-4 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border ${e.status === "active" ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground border-border"}`}>{e.status === "active" ? "Active" : "Inactive"}</span></td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] block ${e.barcode ? "text-emerald-600" : "text-muted-foreground"}`}>QR {e.barcode ? "✓" : "—"}</span>
                    <span className={`text-[11px] block ${e.has_pin ? "text-emerald-600" : "text-amber-600"}`}>PIN {e.has_pin ? "✓" : "✗"}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1">
                      <IconButton icon={<Pencil className="w-4 h-4" />} title="Edit" onClick={() => openEdit(e)} />
                      <IconButton icon={<QrCode className="w-4 h-4" />} title="Reset code" tone="hover:text-amber-600" disabled={busy} onClick={() => ask({ title: "Reset attendance code?", body: `Generate a new QR/barcode for ${e.name}? The old code stops working.`, confirmLabel: "Reset", danger: false, onConfirm: () => doReset(e.employeeId) })} />
                      <IconButton icon={<Trash2 className="w-4 h-4" />} title="Delete" tone="hover:text-red-600" onClick={() => doDelete(e)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
      <Pagination page={curPage} totalPages={totalPages} total={total} from={from} to={to} onPage={setPage} />
      {confirmNode}
    </div>
  );
}

// Modul Lokasi & QR (admin): daftar + tambah lokasi (koordinat GPS asli) + buat
// QR dinamis. "Use my location" mengisi koordinat dari GPS perangkat admin.
function LokasiTab({ token, locations, onCreate, onUpdate, onDelete }: {
  token: string;
  locations: ApiLocation[];
  onCreate: (b: LocationInput) => Promise<void>;
  onUpdate: (id: string, b: LocationInput) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const EMPTY: LocationInput = { name: "", address: "", type: "office", lat: null, lng: null, radius_m: 100 };
  const [mode, setMode] = useState<"list" | "form">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<LocationInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [qr, setQr] = useState<{ loc: string; url: string; codeId: string; type: "dynamic" | "static" } | null>(null);
  const { ask, confirmNode } = useConfirm();
  const inputCls = fieldInput + " w-full";

  const useMyGps = async () => {
    setErr("");
    try { const g = await getDeviceGps(); setForm(f => ({ ...f, lat: g.lat, lng: g.lng })); }
    catch (e: any) { setErr(e?.message || "Failed to get GPS"); }
  };
  const save = async () => {
    const parsed = locationSchema.safeParse(form);
    if (!parsed.success) { setErr(Object.values(zodErrors(parsed.error))[0] || "Invalid input"); return; }
    setBusy(true); setErr("");
    try {
      const body = { ...form, radius_m: Number(form.radius_m) || 100 };
      if (editId) await onUpdate(editId, body); else await onCreate(body);
      setMode("list");
    }
    catch (e: any) { setErr(e?.message || "Failed to save"); }
    finally { setBusy(false); }
  };
  const openAdd = () => { setEditId(null); setForm(EMPTY); setErr(""); setMode("form"); };
  const openEdit = (l: ApiLocation) => { setEditId(l.locationId); setForm({ name: l.name, address: l.address ?? "", type: l.type, lat: l.lat, lng: l.lng, radius_m: l.radius_m }); setErr(""); setMode("form"); };
  const delLoc = async (l: ApiLocation) => {
    try { await onDelete(l.locationId); if (qr?.loc === l.locationId) setQr(null); }
    catch (e: any) { setErr(e?.message || "Failed to delete"); }
  };
  const deleteQr = async () => {
    if (!qr) return; setBusy(true); setErr("");
    try { await api.deleteLocationCode(token, qr.loc, qr.codeId); setQr(null); toast.success("QR code deleted"); }
    catch (e: any) { setErr(e?.message || "Failed to delete QR"); } finally { setBusy(false); }
  };
  const genDynamic = async (locId: string) => {
    setBusy(true); setErr("");
    try { const r = await api.createDynamicCode(token, locId, "hourly"); setQr({ loc: locId, url: r.qrImageUrl, codeId: r.codeId, type: "dynamic" }); }
    catch (e: any) { setErr(e?.message || "Failed to create QR"); } finally { setBusy(false); }
  };
  const genStatic = async (locId: string) => {
    setBusy(true); setErr("");
    try { const r = await api.createStaticCode(token, locId); setQr({ loc: locId, url: r.qrImageUrl, codeId: r.codeId, type: "static" }); }
    catch (e: any) { setErr(e?.message || "Failed to create QR"); } finally { setBusy(false); }
  };
  const refreshQr = async () => {
    if (!qr) return; setBusy(true); setErr("");
    try { const r = await api.refreshCode(token, qr.loc, qr.codeId); setQr({ ...qr, url: r.qrImageUrl }); }
    catch (e: any) { setErr(e?.message || "Failed to refresh"); } finally { setBusy(false); }
  };
  const deactivateQr = async () => {
    if (!qr) return; setBusy(true); setErr("");
    try { await api.updateCode(token, qr.loc, qr.codeId, { status: "inactive" }); setQr(null); toast.success("QR deactivated"); }
    catch (e: any) { setErr(e?.message || "Failed to deactivate"); } finally { setBusy(false); }
  };

  if (mode === "form") return (
    <div className="space-y-4 max-w-xl">
      <TabIntro title={editId ? "Edit Location" : "Add Attendance Location"} subtitle="GPS coordinates + radius drive the check-in geofence" />
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <SectionCard title="Location details" icon={<MapPin className="w-4 h-4" />} bodyClassName="p-5 space-y-3">
        <Field label="Location Name"><input className={inputCls} placeholder="e.g. Head Office" value={form.name ?? ""} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Address"><input className={inputCls} placeholder="Location address" value={form.address ?? ""} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude"><input className={inputCls} type="number" step="any" placeholder="-6.2088" value={form.lat ?? ""} onChange={e => setForm(f => ({ ...f, lat: e.target.value === "" ? null : Number(e.target.value) }))} /></Field>
          <Field label="Longitude"><input className={inputCls} type="number" step="any" placeholder="106.8456" value={form.lng ?? ""} onChange={e => setForm(f => ({ ...f, lng: e.target.value === "" ? null : Number(e.target.value) }))} /></Field>
        </div>
        <Field label="Validation radius (meters)"><input className={inputCls} type="number" placeholder="100" value={form.radius_m ?? 100} onChange={e => setForm(f => ({ ...f, radius_m: Number(e.target.value) }))} /></Field>
        <button onClick={useMyGps} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"><MapPin className="w-3.5 h-3.5" />Use my GPS coordinates now</button>
        {form.lat != null && form.lng != null && (
          <div className="rounded-xl overflow-hidden border border-border">
            <iframe title="Location map preview" className="w-full h-44 border-0" loading="lazy"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${form.lng - 0.004}%2C${form.lat - 0.004}%2C${form.lng + 0.004}%2C${form.lat + 0.004}&layer=mapnik&marker=${form.lat}%2C${form.lng}`} />
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30 text-[11px]">
              <span className="text-muted-foreground">Geofence radius: <b className="text-foreground">{form.radius_m || 100} m</b> from this point</span>
              <a href={`https://www.openstreetmap.org/?mlat=${form.lat}&mlon=${form.lng}#map=18/${form.lat}/${form.lng}`} target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline">Open map ↗</a>
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button disabled={busy} onClick={save} className={btnPrimary}><Check className="w-4 h-4" />{busy ? "Saving…" : "Save"}</button>
          <button disabled={busy} onClick={() => setMode("list")} className={btnGhost}>Cancel</button>
        </div>
      </SectionCard>
    </div>
  );

  return (
    <div className="space-y-4">
      <TabIntro title="Locations & QR" subtitle={`${locations.length} location${locations.length === 1 ? "" : "s"} registered · generate entrance QR codes`}
        action={<button onClick={openAdd} className={btnPrimary}><MapPin className="w-4 h-4" />Add Location</button>} />
      {err && <ErrorBanner>{err}</ErrorBanner>}
      {locations.length === 0 && (
        <Card><EmptyState icon={<MapPin className="w-5 h-5" />} title="No locations yet" hint="Add an office and its GPS coordinates so radius (geofence) validation works."
          action={<button onClick={openAdd} className={btnPrimary}><MapPin className="w-4 h-4" />Add Location</button>} /></Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {locations.map(l => (
          <Card key={l.locationId} className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-sm">{l.name}</p>
                <p className="text-xs text-muted-foreground">{l.address || "—"}</p>
                <p className="text-[11px] font-mono text-muted-foreground mt-1">{l.lat != null && l.lng != null ? `${l.lat}, ${l.lng}` : "GPS not set"} · radius {l.radius_m}m
                  {l.lat != null && l.lng != null && <a href={`https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=18/${l.lat}/${l.lng}`} target="_blank" rel="noreferrer" className="ml-2 text-primary font-semibold hover:underline not-italic">Map ↗</a>}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">{l.type}</span>
                <button title="Edit location" onClick={() => openEdit(l)} className="text-muted-foreground hover:text-primary p-1"><Pencil className="w-3.5 h-3.5" /></button>
                <button title="Delete location" onClick={() => ask({ title: "Delete location?", body: `Permanently remove "${l.name}"? Its QR codes and geofence go too. This cannot be undone.`, onConfirm: () => delLoc(l) })} className="text-muted-foreground hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy} onClick={() => genDynamic(l.locationId)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 disabled:opacity-50"><Zap className="w-3.5 h-3.5" />Dynamic QR</button>
              <button disabled={busy} onClick={() => genStatic(l.locationId)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-foreground text-xs font-semibold hover:bg-muted/70 disabled:opacity-50"><QrCode className="w-3.5 h-3.5" />Static QR</button>
            </div>
            {qr?.loc === l.locationId && (
              <div className="mt-3 flex flex-col items-center gap-2">
                <img src={qr.url} alt="Location QR" width={140} height={140} className="rounded border border-border" />
                <p className="text-[10px] text-muted-foreground text-center">{qr.type === "dynamic" ? "Dynamic" : "Static"} QR active — show/post at the entrance</p>
                <div className="flex gap-2">
                  {qr.type === "dynamic" && <button disabled={busy} onClick={refreshQr} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border text-[11px] font-semibold hover:bg-muted/40"><RefreshCw className="w-3 h-3" />Refresh</button>}
                  <button disabled={busy} onClick={deactivateQr} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-200 text-amber-600 text-[11px] font-semibold hover:bg-amber-50"><X className="w-3 h-3" />Deactivate</button>
                  <button disabled={busy} onClick={() => ask({ title: "Delete this QR code?", body: "Permanently remove this QR code. Employees can no longer scan it.", onConfirm: deleteQr })} className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-200 text-red-600 text-[11px] font-semibold hover:bg-red-50"><Trash2 className="w-3 h-3" />Delete</button>
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>
      {confirmNode}
    </div>
  );
}

// Modul Shift kerja (admin) — CRUD ke /api/shifts.
function ShiftTab({ token }: { token: string }) {
  const [form, setForm] = useState({ name: "", start: "08:00", end: "17:00" });
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { ask, confirmNode } = useConfirm();
  const dirty = editId !== null || form.name.trim() !== "";
  const { data, error: loadErr, reload } = usePolledData(() => api.shifts(token), { paused: dirty });
  const items = data ?? [];
  const pg = usePagination(items);
  const reset = () => { setForm({ name: "", start: "08:00", end: "17:00" }); setEditId(null); };
  const save = async () => {
    { const parsed = shiftSchema.safeParse(form); if (!parsed.success) { setErr(Object.values(zodErrors(parsed.error))[0] || "Invalid input"); return; } }
    setBusy(true); setErr("");
    try { if (editId) await api.updateShift(token, editId, form); else await api.createShift(token, form); reset(); reload(); }
    catch (e: any) { setErr(e?.message || "Failed"); } finally { setBusy(false); }
  };
  const del = async (id: string) => { setErr(""); try { await api.deleteShift(token, id); if (editId === id) reset(); reload(); } catch (e: any) { setErr(e?.message || "Failed to delete"); } };
  return (
    <div className="space-y-4">
      <TabIntro title="Work Shifts" subtitle="Define shift names and start/end times for scheduling" />
      {(err || loadErr) && <ErrorBanner>{err || loadErr}</ErrorBanner>}
      <SectionCard title={editId ? "Edit shift" : "Add shift"} icon={<Timer className="w-4 h-4" />} bodyClassName="p-4 flex flex-wrap items-end gap-2">
        <Field label="Shift Name"><input className={fieldInput} placeholder="e.g. Morning" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Start"><input type="time" className={fieldInput} value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} /></Field>
        <Field label="End"><input type="time" className={fieldInput} value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} /></Field>
        <button disabled={busy} onClick={save} className={btnPrimary}>{editId ? "Update" : "Add"}</button>
        {editId && <button onClick={reset} className={btnGhost}>Cancel</button>}
      </SectionCard>
      <SectionCard title="Shifts" subtitle={data ? `${items.length} total` : undefined} bodyClassName="p-0">
        {!data ? <TableSkeleton rows={4} cols={4} /> : items.length === 0 ? (
          <EmptyState icon={<Timer className="w-5 h-5" />} title="No shifts yet" hint="Add a shift above to use it in scheduling." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/20">{["Shift", "Start", "End", ""].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {pg.pageItems.map(s => <tr key={s.shiftId} className="hover:bg-muted/20 transition-colors"><td className="px-4 py-2.5 font-semibold">{s.name}</td><td className="px-4 py-2.5 font-mono">{s.start}</td><td className="px-4 py-2.5 font-mono">{s.end}</td><td className="px-4 py-2.5"><div className="flex items-center gap-1 justify-end"><IconButton icon={<Pencil className="w-4 h-4" />} title="Edit" onClick={() => { setEditId(s.shiftId); setForm({ name: s.name, start: s.start, end: s.end }); }} /><IconButton icon={<Trash2 className="w-4 h-4" />} title="Delete" tone="hover:text-red-600" onClick={() => ask({ title: "Delete shift?", body: `Remove the "${s.name}" shift?`, onConfirm: () => del(s.shiftId) })} /></div></td></tr>)}
            </tbody>
          </table>
        )}
      </SectionCard>
      {confirmNode}
      <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} from={pg.from} to={pg.to} onPage={pg.setPage} />
    </div>
  );
}

// Modul Perangkat terdaftar (admin) — /api/devices.
function DeviceTab({ token, employees }: { token: string; employees: ApiEmployee[] }) {
  const [form, setForm] = useState({ employeeId: "", deviceId: "", label: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { ask, confirmNode } = useConfirm();
  const dirty = !!editId || !!form.employeeId || form.deviceId.trim() !== "";
  const { data, error: loadErr, reload } = usePolledData(() => api.devices(token), { paused: dirty });
  const items = data ?? [];
  const pg = usePagination(items);
  const reset = () => { setEditId(null); setForm({ employeeId: "", deviceId: "", label: "" }); };
  const save = async () => {
    if (editId) { // hanya label yang dapat diubah (employee & deviceId terkunci)
      setBusy(true); setErr("");
      try { await api.updateDevice(token, editId, { label: form.label || null }); reset(); reload(); }
      catch (e: any) { setErr(e?.message || "Failed"); } finally { setBusy(false); }
      return;
    }
    if (!form.employeeId || !form.deviceId.trim()) { setErr("Employee & device ID are required"); return; }
    setBusy(true); setErr("");
    try { await api.createDevice(token, form); reset(); reload(); }
    catch (e: any) { setErr(e?.message || "Failed"); } finally { setBusy(false); }
  };
  const openEdit = (d: { id: string; employeeId: string; deviceId: string; label: string | null }) => { setEditId(d.id); setForm({ employeeId: d.employeeId, deviceId: d.deviceId, label: d.label ?? "" }); setErr(""); };
  const del = async (id: string) => { setErr(""); try { await api.deleteDevice(token, id); reload(); } catch (e: any) { setErr(e?.message || "Failed to delete"); } };
  return (
    <div className="space-y-4">
      <TabIntro title="Registered Devices" subtitle="Bind employees to their device for tamper-resistant check-in" />
      {(err || loadErr) && <ErrorBanner>{err || loadErr}</ErrorBanner>}
      <SectionCard title={editId ? "Edit device" : "Register device"} icon={<Smartphone className="w-4 h-4" />} bodyClassName="p-4 flex flex-wrap items-end gap-2">
        <Field label="Employee"><select disabled={!!editId} className={fieldInput + (editId ? " opacity-60" : "")} value={form.employeeId} onChange={e => setForm(f => ({ ...f, employeeId: e.target.value }))}><option value="">Select…</option>{employees.map(e => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</select></Field>
        <Field label="Device ID"><input disabled={!!editId} className={fieldInput + (editId ? " opacity-60" : "")} placeholder="device id / IMEI" value={form.deviceId} onChange={e => setForm(f => ({ ...f, deviceId: e.target.value }))} /></Field>
        <Field label="Label"><input className={fieldInput} placeholder="e.g. John's phone" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></Field>
        <button disabled={busy} onClick={save} className={btnPrimary}>{editId ? "Update" : "Register"}</button>
        {editId && <button onClick={reset} className={btnGhost}>Cancel</button>}
      </SectionCard>
      <SectionCard title="Devices" subtitle={data ? `${items.length} registered` : undefined} bodyClassName="p-0">
        {!data ? <TableSkeleton rows={4} cols={4} /> : items.length === 0 ? (
          <EmptyState icon={<Smartphone className="w-5 h-5" />} title="No devices registered" hint="Register an employee's device so only that phone can record their attendance." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/20">{["Employee", "Device ID", "Label", ""].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {pg.pageItems.map(d => { const e = employees.find(x => x.employeeId === d.employeeId); return <tr key={d.id} className="hover:bg-muted/20 transition-colors"><td className="px-4 py-2.5 font-semibold">{e?.name ?? d.employeeId}</td><td className="px-4 py-2.5 font-mono text-xs">{d.deviceId}</td><td className="px-4 py-2.5">{d.label ?? "—"}</td><td className="px-4 py-2.5"><div className="flex items-center gap-1 justify-end"><IconButton icon={<Pencil className="w-4 h-4" />} title="Edit label" onClick={() => openEdit(d)} /><IconButton icon={<Trash2 className="w-4 h-4" />} title="Delete" tone="hover:text-red-600" onClick={() => ask({ title: "Delete device?", body: `Unregister this device${e ? ` for ${e.name}` : ""}? The employee may need to re-register it.`, onConfirm: () => del(d.id) })} /></div></td></tr>; })}
            </tbody>
          </table>
        )}
      </SectionCard>
      {confirmNode}
      <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} from={pg.from} to={pg.to} onPage={pg.setPage} />
    </div>
  );
}

// Modul Riwayat presensi per karyawan (admin) — /api/employees/:id/attendance.
// Util: unduh teks (CSV/dll) sebagai file via Blob — dipakai ekspor riwayat & gaji.
function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿" + text], { type: mime }); // BOM agar Excel baca UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\r\n");
}
// Parser CSV minimal tapi benar (dukung field ber-tanda kutip & koma di dalamnya).
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* abaikan */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}
// Durasi kerja dari jam masuk→keluar ("HH:MM") → " · Xj Ym" (lewat tengah malam aman).
function workDur(inT?: string | null, outT?: string | null): string {
  if (!inT || !outT) return "";
  const [ih, im] = inT.split(":").map(Number);
  const [oh, om] = outT.split(":").map(Number);
  if ([ih, im, oh, om].some(n => Number.isNaN(n))) return "";
  let mins = (oh * 60 + om) - (ih * 60 + im);
  if (mins < 0) mins += 24 * 60;
  return ` · ${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Menit telat dari jam check-in vs jadwal masuk ("HH:MM"); 0 bila tak telat.
function lateMinOf(checkIn?: string | null, schedIn?: string | null): number {
  if (!checkIn || !schedIn) return 0;
  const [ch, cm] = checkIn.split(":").map(Number);
  const [sh, sm] = schedIn.split(":").map(Number);
  if ([ch, cm, sh, sm].some(n => Number.isNaN(n))) return 0;
  const d = (ch * 60 + cm) - (sh * 60 + sm);
  return d > 0 ? d : 0;
}

// ─── Dashboard (ringkasan agregat dari /api/dashboard, dihitung server-side) ──
function DashboardTab({ token, onNav }: { token: string; onNav: (tab: string) => void }) {
  const { data: d, error } = usePolledData(() => api.dashboard(token));
  if (error && !d) return <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm flex items-center gap-2"><AlertTriangle className="w-4 h-4" />{error}</div>;
  if (!d) return <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-muted/40 animate-pulse" />)}</div>;
  const t = d.today;
  const kpiCards = [
    { label: "Present", value: t.present, tone: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
    { label: "Late", value: t.late, tone: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
    { label: "On Leave", value: t.onLeave, tone: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
    { label: "Absent", value: t.absent, tone: "text-red-700", bg: "bg-red-50 border-red-200" },
    { label: "Attendance Rate", value: `${t.attendanceRate}%`, tone: "text-primary", bg: "bg-primary/5 border-primary/20", sub: `${t.present + t.late}/${t.total} checked in` },
  ];
  const maxTrend = Math.max(1, ...d.trend.map(x => x.checkedIn));
  const maxDept = Math.max(1, ...d.headcountByDept.map(x => x.count));
  const dayLabel = (ymd: string) => { const dt = new Date(ymd + "T00:00:00"); return `${dt.toLocaleDateString("en-US", { weekday: "short" })} ${dt.getDate()}`; };
  return (
    <div className="space-y-4">
      <TabIntro title="Dashboard" subtitle={`Today's attendance overview · ${t.date}`} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {kpiCards.map(c => <StatCard key={c.label} label={c.label} value={c.value} sub={c.sub ?? "today"} tone={c.tone} bg={c.bg} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-sm">Check-ins · last 7 days</p>
            <span className="text-[11px] text-muted-foreground flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-primary" />on-time</span>
              <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-400" />late</span>
            </span>
          </div>
          <div className="flex items-stretch justify-between gap-2 h-36">
            {d.trend.map(x => {
              const h = (x.checkedIn / maxTrend) * 100;
              return (
                <div key={x.date} className="flex-1 flex flex-col items-center gap-1">
                  {/* Track bar ber-tinggi-tetap (flex-1) terpisah dari label → bar tak overflow. */}
                  <div className="flex-1 w-full flex items-end justify-center min-h-0">
                    <div className="w-full max-w-[40px] flex flex-col justify-end rounded-md overflow-hidden bg-muted/40" style={{ height: `${Math.max(h, 3)}%` }} title={`${x.checkedIn} check-ins (${x.late} late)`}>
                      {x.late > 0 && <div className="bg-amber-400" style={{ height: `${(x.late / Math.max(1, x.checkedIn)) * 100}%` }} />}
                      <div className="bg-primary flex-1 min-h-[2px]" />
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{x.checkedIn}</span>
                  <span className="text-[10px] text-muted-foreground">{dayLabel(x.date)}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <button onClick={() => onNav("izin_cuti")} className="w-full text-left bg-card rounded-xl border border-border p-3 hover:border-primary/40 transition-colors flex items-center justify-between">
            <span className="text-sm font-medium">Pending leave requests</span>
            <span className={`text-lg font-bold ${d.pendingLeaves ? "text-amber-600" : "text-muted-foreground"}`}>{d.pendingLeaves}</span>
          </button>
          <button onClick={() => onNav("lokasi")} className="w-full text-left bg-card rounded-xl border border-border p-3 hover:border-primary/40 transition-colors flex items-center justify-between">
            <span className="text-sm font-medium">Active locations</span>
            <span className="text-lg font-bold text-primary">{d.locationCount}</span>
          </button>
          <div className="bg-card rounded-xl border border-border p-3 flex items-center justify-between">
            <span className="text-sm font-medium">Late incidents · {d.month.period}</span>
            <span className="text-lg font-bold text-orange-600">{d.month.lateIncidents}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="font-semibold text-sm mb-3">Headcount by department</p>
          {d.headcountByDept.length === 0 && <p className="text-xs text-muted-foreground">No employees yet.</p>}
          <div className="space-y-2">
            {d.headcountByDept.map(x => (
              <div key={x.department} className="flex items-center gap-2">
                <span className="text-xs w-32 truncate" title={x.department}>{x.department}</span>
                <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary rounded-full" style={{ width: `${(x.count / maxDept) * 100}%` }} /></div>
                <span className="text-xs font-semibold tabular-nums w-6 text-right">{x.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3"><p className="font-semibold text-sm">Recent activity</p><button onClick={() => onNav("log")} className="text-[11px] font-semibold text-primary hover:underline">View all ›</button></div>
          {d.recentActivity.length === 0 && <p className="text-xs text-muted-foreground">No activity yet.</p>}
          <div className="space-y-1.5">
            {d.recentActivity.map((a, i) => (
              <div key={i} className="flex items-center justify-between text-xs gap-2">
                <span className="font-mono text-muted-foreground truncate">{a.action}</span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{new Date(a.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Rekap Kehadiran — SATU tabel gabungan: status LIVE hari ini (telat saat check-in)
// + rekap metrik bulan (sama dgn payroll). Klik baris → halaman detail harian.
function RekapKehadiranTab({ token, attendance, employees }: { token: string; attendance: AttendanceRecord[]; employees: ApiEmployee[] }) {
  const [period, setPeriod] = useState(() => localYM());
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.attendanceRecap>>["employees"]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailRows, setDetailRows] = useState<Array<{ date: string; check_in: string | null; check_out: string | null; status: string; method: string | null }>>([]);
  const [detailBusy, setDetailBusy] = useState(false);

  useEffect(() => {
    setBusy(true); setErr("");
    api.attendanceRecap(token, period).then(r => setRows(r.employees)).catch(e => setErr(e?.message || "Failed to load summary")).finally(() => setBusy(false));
  }, [token, period]);
  useEffect(() => {
    if (!detailId) return;
    setDetailBusy(true);
    api.employeeAttendance(token, detailId, { start: `${period}-01`, end: `${period}-31` })
      .then(setDetailRows).catch(() => setDetailRows([])).finally(() => setDetailBusy(false));
  }, [detailId, period, token]);

  const today = (id: string) => attendance.find(a => a.employeeId === id) || null;
  const exportCsv = () => {
    if (!rows.length) return;
    const csv = toCsv(["Employee", "Department", "Today's Status", "Check-in Today", "Late Today (min)", "Days Worked", "Late Days", "Late Minutes", "Overtime Hours", "Absent Days", "Leave Days"],
      rows.map(r => { const t = today(r.employeeId); return [r.name, r.department ?? "", t?.status ?? "not checked in", t?.checkIn ?? "", lateMinOf(t?.checkIn, r.schedule_in), r.days_worked, r.late_days, r.late_minutes, r.overtime_hours, r.absent_days, r.leave_days]; }));
    downloadText(`rekap-kehadiran-${period}.csv`, csv);
  };
  const mainPg = usePagination(rows);       // tabel rekap utama (12/hal)
  const detailPg = usePagination(detailRows); // tabel detail harian (12/hal)

  // ── Halaman detail harian satu karyawan ──
  if (detailId) {
    const r = rows.find(x => x.employeeId === detailId);
    return (
      <div className="space-y-3">
        <button onClick={() => setDetailId(null)} className="text-sm font-semibold text-primary hover:underline flex items-center gap-1">‹ Back to summary</button>
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="font-bold">{r?.name ?? detailId}</p>
          <p className="text-xs text-muted-foreground">{r?.position || "—"} · {r?.department || "—"} · schedule {r?.schedule_in ?? "—"}–{r?.schedule_out ?? "—"} · period {period}</p>
          {r && <div className="flex flex-wrap gap-2 mt-2 text-xs">
            <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">Days worked: {r.days_worked}</span>
            <span className="px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200">Late: {r.late_days} days · {r.late_minutes} min</span>
            <span className="px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200">Absent: {r.absent_days} days</span>
            <span className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200">Leave: {r.leave_days} days</span>
          </div>}
        </div>
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/30">{["Date", "Check-in", "Check-out", "Status", "Late", "Duration"].map(h => <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {detailBusy && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">Loading…</td></tr>}
              {!detailBusy && detailRows.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground text-sm">No attendance for this period.</td></tr>}
              {detailPg.pageItems.map((d, i) => { const lm = lateMinOf(d.check_in, r?.schedule_in); return (
                <tr key={i} className="hover:bg-muted/20">
                  <td className="px-3 py-2.5 font-mono">{d.date}</td>
                  <td className="px-3 py-2.5 font-mono">{d.check_in ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono">{d.check_out ?? "—"}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={d.status as AttendanceRecord["status"]} /></td>
                  <td className="px-3 py-2.5 font-mono">{lm > 0 ? <span className="text-orange-600 font-semibold">{lm} min</span> : "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{workDur(d.check_in, d.check_out).replace(" · ", "")}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        <Pagination page={detailPg.page} totalPages={detailPg.totalPages} total={detailPg.total} from={detailPg.from} to={detailPg.to} onPage={detailPg.setPage} />
      </div>
    );
  }

  // ── Tabel gabungan (live + rekap) ──
  // KPI hari ini (dari papan kehadiran live) — ringkasan sekali-lihat di atas tabel.
  const kpi = {
    present: attendance.filter(a => a.status === "hadir").length,
    late: attendance.filter(a => a.status === "terlambat").length,
    leave: attendance.filter(a => a.status === "izin" || a.status === "cuti").length,
    absent: attendance.filter(a => a.status === "tidak_hadir").length,
  };
  const totalEmp = employees.length;
  const checkedIn = kpi.present + kpi.late;
  const rate = totalEmp ? Math.round((checkedIn / totalEmp) * 100) : 0;
  const kpiCards = [
    { label: "Present", value: kpi.present, tone: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
    { label: "Late", value: kpi.late, tone: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
    { label: "On Leave", value: kpi.leave, tone: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
    { label: "Absent", value: kpi.absent, tone: "text-red-700", bg: "bg-red-50 border-red-200" },
    { label: "Attendance Rate", value: `${rate}%`, tone: "text-primary", bg: "bg-primary/5 border-primary/20", sub: `${checkedIn}/${totalEmp} checked in` },
  ];
  return (
    <div className="space-y-4">
      <TabIntro title="Attendance Summary" subtitle="Today's live status + monthly recap · click a row for daily detail"
        action={<><input type="month" className={fieldInput} value={period} onChange={e => setPeriod(e.target.value)} /><button disabled={!rows.length} onClick={exportCsv} className={btnGhost}><Download className="w-4 h-4" />Export CSV</button></>} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {kpiCards.map(c => <StatCard key={c.label} label={c.label} value={c.value} sub={c.sub ?? "today"} tone={c.tone} bg={c.bg} />)}
      </div>
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <SectionCard title={`Employees · ${period}`} subtitle={rows.length ? `${rows.length} employees` : undefined} icon={<Activity className="w-4 h-4" />} bodyClassName="p-0">
        {busy && rows.length === 0 ? <TableSkeleton rows={6} cols={6} /> : rows.length === 0 ? (
          <EmptyState icon={<Activity className="w-5 h-5" />} title="No data for this period" hint="No employees or attendance records for the selected month." />
        ) : (
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border bg-muted/20">
            {["Employee", "Today's Status", "Check-in", "Late Today", "Days Worked", "Late (days)", "Late Min (mo)", "Absent", ""].map(h => <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {mainPg.pageItems.map(r => {
              const t = today(r.employeeId);
              const lmToday = lateMinOf(t?.checkIn, r.schedule_in);
              return (
                <tr key={r.employeeId} className="hover:bg-muted/20 cursor-pointer" onClick={() => setDetailId(r.employeeId)}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <Avatar initials={(r.name || "?").split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase()} size="sm" />
                      <div><p className="font-semibold">{r.name}</p><p className="text-[11px] text-muted-foreground">{r.position || "—"} · {r.department || "—"}</p></div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">{t ? <StatusBadge status={t.status} /> : <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">Not checked in</span>}</td>
                  <td className="px-3 py-2.5 font-mono">{t?.checkIn ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono">{lmToday > 0 ? <span className="text-orange-600 font-semibold">{lmToday} min</span> : "—"}</td>
                  <td className="px-3 py-2.5 font-mono">{r.days_worked}</td>
                  <td className="px-3 py-2.5 font-mono">{r.late_days > 0 ? <span className="text-amber-600 font-semibold">{r.late_days}</span> : "0"}</td>
                  <td className="px-3 py-2.5 font-mono">{r.late_minutes > 0 ? <span className="text-orange-600 font-semibold">{r.late_minutes}</span> : "0"}</td>
                  <td className="px-3 py-2.5 font-mono">{r.absent_days > 0 ? <span className="text-red-600 font-semibold">{r.absent_days}</span> : "0"}</td>
                  <td className="px-3 py-2.5"><span className="text-primary text-xs font-semibold whitespace-nowrap">Details ›</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        )}
      </SectionCard>
      <Pagination page={mainPg.page} totalPages={mainPg.totalPages} total={mainPg.total} from={mainPg.from} to={mainPg.to} onPage={mainPg.setPage} />
    </div>
  );
}

function RiwayatTab({ token, employees }: { token: string; employees: ApiEmployee[] }) {
  const [empId, setEmpId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rows, setRows] = useState<Array<{ date: string; check_in: string | null; check_out: string | null; status: string; method: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = async () => {
    if (!empId) { setErr("Select an employee"); return; }
    setBusy(true); setErr("");
    try { setRows(await api.employeeAttendance(token, empId, { start, end })); }
    catch (e: any) { setErr(e?.message || "Failed"); } finally { setBusy(false); }
  };
  // Auto-pilih karyawan pertama SEKALI. Pakai id (string stabil), BUKAN array
  // employees yang referensinya berubah tiap polling (cegah re-render loop).
  const firstEmpId = employees[0]?.employeeId;
  useEffect(() => {
    if (!empId && firstEmpId) setEmpId(firstEmpId);
  }, [firstEmpId, empId]);
  // Muat riwayat saat karyawan dipilih. TIDAK bergantung pada polling employees,
  // jadi tak re-fetch/flicker tiap interval. Filter tanggal dipakai via "Tampilkan".
  useEffect(() => {
    if (!empId) return;
    let alive = true;
    api.employeeAttendance(token, empId, { start, end }).then(r => { if (alive) setRows(r); }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId, token]);
  // Ringkasan per status (hadir/terlambat/izin/dll) dari baris yang dimuat.
  const summary = rows.reduce((a, r) => { a.total++; a[r.status] = (a[r.status] || 0) + 1; return a; }, { total: 0 } as Record<string, number>);
  const STAT_LABEL: Record<string, string> = { hadir: "Present", terlambat: "Late", izin: "Permission", cuti: "Leave", alpha: "Absent", absent: "Absent" };
  const empName = employees.find(e => e.employeeId === empId)?.name || empId;
  const exportCsv = () => {
    if (!rows.length) return;
    const csv = toCsv(["Date", "Check-in", "Check-out", "Status", "Method"],
      rows.map(r => [r.date, r.check_in ?? "", r.check_out ?? "", STAT_LABEL[r.status] || r.status, r.method ?? ""]));
    downloadText(`history-${empName}-${start || "awal"}_sd_${end || "akhir"}.csv`, csv);
  };
  const pg = usePagination(rows);
  const statTone: Record<string, { tone: string; bg: string }> = {
    hadir: { tone: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
    terlambat: { tone: "text-amber-700", bg: "bg-amber-50 border-amber-200" },
    izin: { tone: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
    cuti: { tone: "text-purple-700", bg: "bg-purple-50 border-purple-200" },
    alpha: { tone: "text-red-700", bg: "bg-red-50 border-red-200" },
    absent: { tone: "text-red-700", bg: "bg-red-50 border-red-200" },
  };
  return (
    <div className="space-y-4">
      <TabIntro title="Attendance History" subtitle="Per-employee check-in/out log with date range filter & CSV export"
        action={<button disabled={!rows.length} onClick={exportCsv} title="Export CSV (Excel)" className={btnGhost}><Download className="w-4 h-4" />Export CSV</button>} />
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <SectionCard title="Filter" icon={<Calendar className="w-4 h-4" />} bodyClassName="p-4 flex flex-wrap items-end gap-2">
        <Field label="Employee"><select className={fieldInput} value={empId} onChange={e => setEmpId(e.target.value)}><option value="">Select…</option>{employees.map(e => <option key={e.employeeId} value={e.employeeId}>{e.name}</option>)}</select></Field>
        <Field label="From"><input type="date" className={fieldInput} value={start} onChange={e => setStart(e.target.value)} /></Field>
        <Field label="To"><input type="date" className={fieldInput} value={end} onChange={e => setEnd(e.target.value)} /></Field>
        <button disabled={busy} onClick={load} className={btnPrimary}>{busy ? "Loading…" : "Show"}</button>
      </SectionCard>
      {rows.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <StatCard label="Total days" value={summary.total} tone="text-primary" bg="bg-primary/5 border-primary/20" />
          {Object.keys(summary).filter(k => k !== "total").map(k => (
            <StatCard key={k} label={STAT_LABEL[k] || k} value={summary[k]} tone={statTone[k]?.tone} bg={statTone[k]?.bg} />
          ))}
        </div>
      )}
      <SectionCard title={`Records${empName ? ` — ${empName}` : ""}`} subtitle={rows.length ? `${rows.length} record${rows.length === 1 ? "" : "s"}` : undefined} bodyClassName="p-0">
        {busy && rows.length === 0 ? (
          <TableSkeleton rows={6} cols={5} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Calendar className="w-5 h-5" />} title="No records to show" hint='Pick an employee and (optionally) a date range, then click "Show".' />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/20">{["Date", "Check-in", "Check-out", "Status", "Method"].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {pg.pageItems.map((r, i) => <tr key={i} className="hover:bg-muted/20 transition-colors"><td className="px-4 py-2.5 font-mono">{r.date}</td><td className="px-4 py-2.5 font-mono">{r.check_in ?? "—"}</td><td className="px-4 py-2.5 font-mono">{r.check_out ?? "—"}</td><td className="px-4 py-2.5"><StatusBadge status={r.status as AttendanceRecord["status"]} /></td><td className="px-4 py-2.5 text-xs"><MethodBadge method={(r.method as AttendanceRecord["method"]) ?? "manual"} /></td></tr>)}
            </tbody>
          </table>
        )}
      </SectionCard>
      <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} from={pg.from} to={pg.to} onPage={pg.setPage} />
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
    try { await api.updateCompany(token, { name: co.name, address: co.address, contact_email: co.contact_email, industry: co.industry, work_hours: co.work_hours }); if (co.logo_url) await api.setLogo(token, co.logo_url); setMsg("Profile saved"); }
    catch (e: any) { setErr(e?.message || "Failed"); } finally { setBusy(false); }
  };
  const saveSettings = async () => {
    setBusy(true); setErr(""); setMsg("");
    try { await api.updateCompanySettings(token, settings); setMsg("Settings saved"); }
    catch (e: any) { setErr(e?.message || "Failed"); } finally { setBusy(false); }
  };
  const addCompany = async () => {
    if (!newCo.trim()) return;
    setBusy(true); setErr(""); setMsg("");
    try { await api.registerCompany(token, { company_name: newCo.trim() }); setNewCo(""); setMsg("Company/branch added"); }
    catch (e: any) { setErr(e?.message || "Failed"); } finally { setBusy(false); }
  };
  const ff = fieldInput + " w-full";
  if (!co) return (
    <div className="space-y-4 max-w-2xl">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
  return (
    <div className="space-y-4 max-w-2xl">
      <TabIntro title="Company Settings" subtitle="Profile, attendance mode, timezone, currency & branches" />
      {err && <ErrorBanner>{err}</ErrorBanner>}
      {msg && <InfoBanner>{msg}</InfoBanner>}
      <SectionCard title="Company Profile" icon={<Building2 className="w-4 h-4" />} bodyClassName="p-5 space-y-3">
        <Field label="Name"><input className={ff} value={co.name ?? ""} onChange={e => setCo({ ...co, name: e.target.value })} /></Field>
        <Field label="Address"><input className={ff} value={co.address ?? ""} onChange={e => setCo({ ...co, address: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Clock-in"><input type="time" className={ff} value={co.work_hours?.start ?? ""} onChange={e => setCo({ ...co, work_hours: { ...co.work_hours, start: e.target.value } })} /></Field>
          <Field label="Clock-out"><input type="time" className={ff} value={co.work_hours?.end ?? ""} onChange={e => setCo({ ...co, work_hours: { ...co.work_hours, end: e.target.value } })} /></Field>
        </div>
        <Field label="Logo URL"><input className={ff} placeholder="https://…" value={co.logo_url ?? ""} onChange={e => setCo({ ...co, logo_url: e.target.value })} /></Field>
        <button disabled={busy} onClick={saveProfile} className={btnPrimary}><Check className="w-4 h-4" />Save Profile</button>
      </SectionCard>
      {settings && (
        <SectionCard title="App Settings" icon={<Timer className="w-4 h-4" />} bodyClassName="p-5 space-y-3">
          <Field label="Attendance Mode"><select className={ff} value={settings.attendance_mode} onChange={e => setSettings({ ...settings, attendance_mode: e.target.value })}><option value="qr_dynamic">Dynamic QR</option><option value="qr_static">Static QR</option></select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Time Zone"><input className={ff} value={settings.timezone ?? ""} onChange={e => setSettings({ ...settings, timezone: e.target.value })} /></Field>
            <Field label="Language"><input className={ff} value={settings.language ?? ""} onChange={e => setSettings({ ...settings, language: e.target.value })} /></Field>
            <Field label="Currency (salary & payroll)" className="col-span-2">
              <select className={ff} value={settings.base_currency ?? "IDR"} onChange={e => setSettings({ ...settings, base_currency: e.target.value })}>
                {["IDR", "USD", "EUR", "GBP", "SGD", "MYR", "JPY", "CNY", "AUD", "INR", "AED", "SAR"].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">The company's operating currency. All salary/payslip amounts & rate labels follow this — not pinned to Rupiah.</p>
            </Field>
          </div>
          <button disabled={busy} onClick={saveSettings} className={btnPrimary}><Check className="w-4 h-4" />Save Settings</button>
        </SectionCard>
      )}
      <SectionCard title="Add Company / Branch" icon={<Building2 className="w-4 h-4" />} bodyClassName="p-5">
        <div className="flex gap-2"><input className={ff} placeholder="New company/branch name" value={newCo} onChange={e => setNewCo(e.target.value)} /><button disabled={busy} onClick={addCompany} className={btnPrimary + " whitespace-nowrap"}>Add</button></div>
      </SectionCard>
    </div>
  );
}

// Modul Log audit aktivitas admin (admin) — /api/logs.
function LogTab({ token }: { token: string }) {
  const { data, error: err } = usePolledData(() => api.logs(token));
  const rows = data ?? [];
  const pg = usePagination(rows);
  const fmtTs = (s: string) => { try { return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch { return s; } };
  return (
    <div className="space-y-4">
      <TabIntro title="Audit Log" subtitle="Admin actions recorded for security & compliance (read-only)" />
      {err && <ErrorBanner>{err}</ErrorBanner>}
      <SectionCard title="Activity" subtitle={data ? `${rows.length} ${rows.length === 1 ? "entry" : "entries"}` : undefined} icon={<BarChart2 className="w-4 h-4" />} bodyClassName="p-0">
        {!data ? (
          <TableSkeleton rows={8} cols={3} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<BarChart2 className="w-5 h-5" />} title="No activity yet" hint="Admin actions (create/update/delete, sign-ins) will appear here as they happen." />
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/20">{["Time", "Action", "Details"].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {pg.pageItems.map(l => <tr key={l.id} className="hover:bg-muted/20 transition-colors"><td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-muted-foreground">{fmtTs(l.created_at)}</td><td className="px-4 py-2.5"><span className="inline-block font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-muted text-foreground">{l.action}</span></td><td className="px-4 py-2.5 text-xs text-muted-foreground font-mono truncate max-w-md">{l.detail ?? "—"}</td></tr>)}
            </tbody>
          </table>
        )}
      </SectionCard>
      <Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} from={pg.from} to={pg.to} onPage={pg.setPage} />
    </div>
  );
}

// Modul Penggajian (admin) — komponen gaji + aturan otomatis + proses payroll +
// slip (terintegrasi absensi via /api/payroll*).
const BASIS_LABEL: Record<string, string> = { fixed: "Fixed", percent_base: "% of base salary", per_late_min: "per late minute", per_absent_day: "per absent day", per_overtime_hour: "per overtime hour" };
const METRIC_LABEL: Record<string, string> = { late_days: "Late days", late_minutes: "Late minutes", overtime_hours: "Overtime hours", absent_days: "Absent days", leave_days: "Leave days", days_worked: "Days worked" };
const METRIC_UNIT: Record<string, string> = { late_days: "days", late_minutes: "min", overtime_hours: "h", absent_days: "days", leave_days: "days", days_worked: "days" };
// Nilai metrik + satuan; menit telat juga ditampilkan dalam jam-menit ("235 min · 3h 55m").
function fmtMetricVal(k: string, v: any): string {
  const u = METRIC_UNIT[k];
  if (k === "late_minutes" && Number(v) >= 60) return `${v} min · ${Math.floor(v / 60)}h ${v % 60}m`;
  return u ? `${v} ${u}` : String(v);
}
// Format uang dinamis sesuai kode mata uang ISO 4217 (multi-currency — TIDAK
// dipaku ke IDR). Locale en-US hanya untuk pemisah ribuan; simbol & penempatan
// otomatis dari Intl. Fallback bila kode mata uang tak dikenal.
const ZERO_DECIMAL_CUR = ["IDR", "JPY", "KRW", "VND"];
function fmtMoney(n: number, currency = "IDR") {
  const v = Number.isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency", currency,
      maximumFractionDigits: ZERO_DECIMAL_CUR.includes(currency) ? 0 : 2,
    }).format(v);
  } catch { return `${currency} ${v.toLocaleString("en-US")}`; }
}

function PayrollTab({ token }: { token: string }) {
  const [slips, setSlips] = useState<Payslip[] | null>(null);
  const [detail, setDetail] = useState<Payslip | null>(null);
  const [period, setPeriod] = useState(() => localYM());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [cForm, setCForm] = useState({ name: "", type: "earning", basis: "fixed", value: 0 });
  const [rForm, setRForm] = useState({ name: "", metric: "late_days", op: "gte", threshold: 0, action: "deduction", amount: 0 });
  const [cEditId, setCEditId] = useState<string | null>(null); // edit komponen gaji
  const [rEditId, setREditId] = useState<string | null>(null); // edit aturan otomatis
  const { ask, confirmNode } = useConfirm();
  const [currency, setCurrency] = useState("IDR"); // mata uang TAMPILAN slip
  const inputCls = fieldInput;

  // Satu sumber data + poll; JEDA saat form/modal terbuka (cegah input ke-reset).
  const paused = cForm.name.trim() !== "" || rForm.name.trim() !== "" || detail !== null || !!cEditId || !!rEditId;
  const { data, error: loadErr, reload } = usePolledData(
    () => Promise.all([
      api.salaryComponents(token),
      api.payrollRules(token),
      api.payrollRuns(token),
      api.exchangeRates(token),
      api.companySettings(token).then(s => s.base_currency || "IDR"),
    ]),
    { paused },
  );
  const [comps, rules, runs, rates, baseCur] = data ?? [[], [], [], [], "IDR"] as [SalaryComponent[], PayrollRule[], PayrollRun[], ExchangeRate[], string];
  useEffect(() => { setCurrency(baseCur); }, [baseCur]); // default tampilan = mata uang perusahaan

  // Kurs terbaru per mata uang (1 unit asing = rate base_currency).
  const latestRate: Record<string, number> = {};
  for (const r of rates) if (!latestRate[r.currency]) latestRate[r.currency] = r.rate;
  // Nilai slip disimpan dalam base_currency. Tampilkan apa adanya, atau konversi
  // ke mata uang lain yang dipilih (untuk telaah lintas-negara).
  const fmt = (amount: number) => {
    if (currency === baseCur || !latestRate[currency]) return fmtMoney(amount, baseCur);
    return fmtMoney(amount / latestRate[currency], currency);
  };

  const resetComp = () => { setCEditId(null); setCForm({ name: "", type: "earning", basis: "fixed", value: 0 }); };
  const saveComp = async () => { const v = salaryComponentSchema.safeParse(cForm); if (!v.success) { setErr(Object.values(zodErrors(v.error))[0] || "Invalid input"); return; } setBusy(true); setErr(""); try { const body = { ...cForm, value: Number(cForm.value) || 0 }; if (cEditId) await api.updateSalaryComponent(token, cEditId, body); else await api.createSalaryComponent(token, body); resetComp(); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const editComp = (c: SalaryComponent) => { setCEditId(c.id); setCForm({ name: c.name, type: c.type, basis: c.basis, value: c.value }); };
  const delComp = (c: SalaryComponent) => ask({ title: "Delete salary component?", body: `Remove "${c.name}"? Future payroll runs won't include it.`, onConfirm: () => api.deleteSalaryComponent(token, c.id).then(reload) });
  const resetRule = () => { setREditId(null); setRForm({ name: "", metric: "late_days", op: "gte", threshold: 0, action: "deduction", amount: 0 }); };
  const saveRule = async () => { const v = payrollRuleSchema.safeParse(rForm); if (!v.success) { setErr(Object.values(zodErrors(v.error))[0] || "Invalid input"); return; } setBusy(true); setErr(""); try { const body = { ...rForm, threshold: Number(rForm.threshold) || 0, amount: Number(rForm.amount) || 0 }; if (rEditId) await api.updatePayrollRule(token, rEditId, body); else await api.createPayrollRule(token, body); resetRule(); reload(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const editRule = (r: PayrollRule) => { setREditId(r.id); setRForm({ name: r.name, metric: r.metric, op: r.op, threshold: r.threshold, action: r.action, amount: r.amount }); };
  const delRule = (r: PayrollRule) => ask({ title: "Delete rule?", body: `Remove the "${r.name}" rule?`, onConfirm: () => api.deletePayrollRule(token, r.id).then(reload) });
  const delRun = (r: PayrollRun) => ask({ title: "Delete payroll run?", body: `Delete the ${r.period} run (${r.count} slips)? Generated payslips will be removed. This cannot be undone.`, onConfirm: async () => { await api.deletePayrollRun(token, r.runId); setSlips(null); reload(); } });
  const viewSlips = async (runId: string) => { setBusy(true); setErr(""); try { setSlips(await api.runPayslips(token, runId)); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const runNow = async () => { setConfirmRun(false); setBusy(true); setErr(""); setMsg(""); try { const r = await api.runPayroll(token, period); setMsg(`Payroll ${r.period}: ${r.count} slips · total ${fmtMoney(r.totalNet, baseCur)}`); reload(); await viewSlips(r.runId); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const [confirmRun, setConfirmRun] = useState(false);
  // Rekap CSV dari slip yang sedang ditampilkan (nilai dalam base_currency).
  const exportSlipsCsv = () => {
    if (!slips?.length) return;
    const csv = toCsv(["Employee", "Period", "Base Salary", "Allowance", "Deduction", "Net Pay"],
      slips.map(s => [s.name, s.period, s.base_salary, s.earnings, s.deductions, s.net]));
    downloadText(`rekap-gaji-${slips[0]?.period || period}.csv`, csv);
  };
  // Agregat rekap untuk slip yang ditampilkan.
  const slipAgg = (slips || []).reduce((a, s) => { a.base += s.base_salary; a.earn += s.earnings; a.ded += s.deductions; a.net += s.net; return a; }, { base: 0, earn: 0, ded: 0, net: 0 });
  const slipPg = usePagination(slips || []);
  const runPg = usePagination(runs);
  // Cetak slip → jendela baru ber-styling → dialog print/PDF browser.
  const printSlip = (s: Payslip) => {
    // Escape SEMUA nilai dari server/CSV sebelum di-inject ke jendela cetak. window.open("")
    // menghasilkan dokumen about:blank yang SAMA-ORIGIN dengan app; markup yang ditulis via
    // document.write akan DIEKSEKUSI, jadi nama/catatan berisi "<img src=x onerror=...>" bisa
    // membaca token admin di localStorage. Escape menutup vektor pencurian sesi ini.
    const esc = (v: any) => String(v ?? "").replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    const lines = (s.detail?.lines || []).map((l: any) =>
      `<tr><td>${esc(l.name)}${l.note ? `<div class="muted">${esc(l.note)}</div>` : ""}</td><td class="r" style="color:${l.type === "earning" ? "#0a7d4a" : "#c0392b"}">${l.type === "earning" ? "+" : "−"}${fmtMoney(l.amount, baseCur)}</td></tr>`).join("");
    const metrics = s.detail ? Object.entries(s.detail.metrics).map(([k, v]) => `<tr><td>${esc(METRIC_LABEL[k] || k)}</td><td class="r">${fmtMetricVal(k, v)}</td></tr>`).join("") : "";
    const w = window.open("", "_blank", "width=520,height=720");
    if (!w) { setErr("Browser blocked the popup — allow popups to print the slip."); return; }
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payslip ${esc(s.name)} ${esc(s.period)}</title>
<style>body{font-family:system-ui,Arial,sans-serif;color:#1B3D72;margin:32px;font-size:13px}h1{font-size:18px;margin:0}.sub{color:#667;font-size:12px;margin:2px 0 16px}table{width:100%;border-collapse:collapse;margin:8px 0}td{padding:5px 0;border-bottom:1px solid #eee}.r{text-align:right;font-variant-numeric:tabular-nums}.tot{font-weight:700;border-top:2px solid #1B3D72;font-size:15px}.sec{font-weight:700;margin-top:14px;color:#0D1B2A}.muted{color:#889;font-size:11px}@media print{body{margin:12mm}}</style></head>
<body><h1>Payslip</h1><div class="sub">${esc(s.name)} · Period ${esc(s.period)} · Currency ${esc(baseCur)}</div>
${metrics ? `<div class="sec">Attendance Metrics</div><table>${metrics}</table>` : ""}
<div class="sec">Breakdown</div><table><tr><td>Base Salary</td><td class="r">${fmtMoney(s.base_salary, baseCur)}</td></tr>${lines}
<tr class="tot"><td>Net Pay</td><td class="r">${fmtMoney(s.net, baseCur)}</td></tr></table>
<p class="muted">Printed from Zylora Attendance & HRIS — valid without a wet signature.</p>
<script>window.onload=function(){window.print()}</script></body></html>`);
    w.document.close();
  };

  return (
    <div className="space-y-4">
      <TabIntro title="Payroll" subtitle="Auto-computed from attendance (late, overtime, absent, leave) + components & rules" />
      {(err || loadErr) && <ErrorBanner>{err || loadErr}</ErrorBanner>}
      {msg && <InfoBanner>{msg}</InfoBanner>}

      {/* Proses payroll */}
      <SectionCard title="Run payroll" icon={<Download className="w-4 h-4" />} bodyClassName="p-4 flex flex-wrap items-end gap-3">
        <Field label="Period"><input type="month" className={inputCls} value={period} onChange={e => setPeriod(e.target.value)} /></Field>
        <button disabled={busy} onClick={() => setConfirmRun(true)} className={btnPrimary}><Download className="w-4 h-4" />{busy ? "Processing…" : "Run Payroll"}</button>
        <p className="text-xs text-muted-foreground">Slips are generated from this period's attendance + active components & rules below.</p>
      </SectionCard>

      {/* Komponen gaji */}
      <SectionCard title="Salary Components" subtitle="Allowances (+) / deductions (−)" icon={<Wallet className="w-4 h-4" />} bodyClassName="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <input className={inputCls} placeholder="Name (e.g. Transport)" value={cForm.name} onChange={e => setCForm(f => ({ ...f, name: e.target.value }))} />
          <select className={inputCls} value={cForm.type} onChange={e => setCForm(f => ({ ...f, type: e.target.value }))}><option value="earning">Allowance (+)</option><option value="deduction">Deduction (−)</option></select>
          <select className={inputCls} value={cForm.basis} onChange={e => setCForm(f => ({ ...f, basis: e.target.value }))}>{Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input type="number" className={inputCls + " w-32"} placeholder="Value" value={cForm.value} onChange={e => setCForm(f => ({ ...f, value: Number(e.target.value) }))} />
          <button disabled={busy} onClick={saveComp} className={btnPrimary}>{cEditId ? "Update" : "Add"}</button>
          {cEditId && <button onClick={resetComp} className={btnGhost}>Cancel</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          {comps.length === 0 && <p className="text-xs text-muted-foreground">No components yet.</p>}
          {comps.map(c => (
            <span key={c.id} className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${cEditId === c.id ? "ring-2 ring-primary/40 " : ""}${c.type === "earning" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
              {c.name}: {c.value} <span className="opacity-60">({BASIS_LABEL[c.basis]})</span>
              <button title="Edit" onClick={() => editComp(c)} className="hover:text-foreground"><Pencil className="w-3 h-3" /></button>
              <button title="Delete" onClick={() => delComp(c)} className="hover:text-foreground"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      </SectionCard>

      {/* Aturan otomatis */}
      <SectionCard title="Automatic Rules" subtitle="Conditional bonus/deduction triggers" icon={<Zap className="w-4 h-4" />} bodyClassName="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <input className={inputCls} placeholder="Rule name" value={rForm.name} onChange={e => setRForm(f => ({ ...f, name: e.target.value }))} />
          <select className={inputCls} value={rForm.metric} onChange={e => setRForm(f => ({ ...f, metric: e.target.value }))}>{Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select className={inputCls} value={rForm.op} onChange={e => setRForm(f => ({ ...f, op: e.target.value }))}><option value="gte">≥</option><option value="gt">&gt;</option></select>
          <input type="number" className={inputCls + " w-24"} placeholder="Threshold" value={rForm.threshold} onChange={e => setRForm(f => ({ ...f, threshold: Number(e.target.value) }))} />
          <select className={inputCls} value={rForm.action} onChange={e => setRForm(f => ({ ...f, action: e.target.value }))}><option value="deduction">Deduction</option><option value="bonus">Bonus</option></select>
          <input type="number" className={inputCls + " w-32"} placeholder={`Amount (${baseCur})`} value={rForm.amount} onChange={e => setRForm(f => ({ ...f, amount: Number(e.target.value) }))} />
          <button disabled={busy} onClick={saveRule} className={btnPrimary}>{rEditId ? "Update" : "Add"}</button>
          {rEditId && <button onClick={resetRule} className={btnGhost}>Cancel</button>}
        </div>
        <div className="space-y-1">
          {rules.length === 0 && <p className="text-xs text-muted-foreground">No rules yet.</p>}
          {rules.map(r => (
            <div key={r.id} className={`flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-1.5 ${rEditId === r.id ? "ring-2 ring-primary/40" : ""}`}>
              <span><b>{r.name}</b> — if {METRIC_LABEL[r.metric]} {r.op === "gt" ? ">" : "≥"} {r.threshold} → {r.action === "bonus" ? "bonus" : "deduction"} {fmtMoney(r.amount, baseCur)}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <IconButton icon={<Pencil className="w-3.5 h-3.5" />} title="Edit" onClick={() => editRule(r)} />
                <IconButton icon={<Trash2 className="w-3.5 h-3.5" />} title="Delete" tone="hover:text-red-600" onClick={() => delRule(r)} />
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Slip hasil run terakhir */}
      {slips && (
        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center justify-between">
            <span className="text-sm font-semibold">Payslips ({slips.length})</span>
            <div className="flex items-center gap-3">
              <button onClick={exportSlipsCsv} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"><Download className="w-3.5 h-3.5" />Export CSV</button>
              <label className="text-xs flex items-center gap-1.5 text-muted-foreground">Show in:
                <select className="px-2 py-1 rounded-lg border border-border text-xs" value={currency} onChange={e => setCurrency(e.target.value)}>
                  <option value={baseCur}>{baseCur}</option>
                  {Object.keys(latestRate).filter(c => c !== baseCur).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
            </div>
          </div>
          {currency !== baseCur && latestRate[currency] && <p className="px-4 pt-2 text-[11px] text-muted-foreground">Exchange rate: 1 {currency} = {fmtMoney(latestRate[currency], baseCur)} (transparent, from Exchange Rates).</p>}
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border bg-muted/20">{["Employee", "Base", "Allowance", "Deduction", "Net", ""].map(h => <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-border">
              {slipPg.pageItems.map(s => (
                <tr key={s.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold">{s.name}</td>
                  <td className="px-4 py-2 font-mono">{fmt(s.base_salary)}</td>
                  <td className="px-4 py-2 font-mono text-emerald-600">+{fmt(s.earnings)}</td>
                  <td className="px-4 py-2 font-mono text-red-600">−{fmt(s.deductions)}</td>
                  <td className="px-4 py-2 font-mono font-bold">{fmt(s.net)}</td>
                  <td className="px-4 py-2"><button onClick={() => setDetail(s)} className="text-primary text-xs hover:underline">Details</button></td>
                </tr>
              ))}
            </tbody>
            {slips.length > 0 && (
              <tfoot><tr className="border-t-2 border-border bg-muted/20 font-bold">
                <td className="px-4 py-2">Total ({slips.length} slips)</td>
                <td className="px-4 py-2 font-mono">{fmt(slipAgg.base)}</td>
                <td className="px-4 py-2 font-mono text-emerald-600">+{fmt(slipAgg.earn)}</td>
                <td className="px-4 py-2 font-mono text-red-600">−{fmt(slipAgg.ded)}</td>
                <td className="px-4 py-2 font-mono">{fmt(slipAgg.net)}</td>
                <td></td>
              </tr></tfoot>
            )}
          </table>
          <div className="px-4 pb-3"><Pagination page={slipPg.page} totalPages={slipPg.totalPages} total={slipPg.total} from={slipPg.from} to={slipPg.to} onPage={slipPg.setPage} /></div>
        </div>
      )}

      {/* Riwayat run */}
      <SectionCard title="Payroll Run History" icon={<Download className="w-4 h-4" />} bodyClassName="p-4 space-y-2">
        {runs.length === 0 ? <p className="text-xs text-muted-foreground py-2">No payroll runs yet.</p> : runPg.pageItems.map(r => (
          <div key={r.runId} className="flex items-center justify-between text-xs bg-muted/30 rounded-lg px-3 py-1.5">
            <span>Period <b>{r.period}</b> · {r.count} slips · total {fmtMoney(r.totalNet, baseCur)}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => viewSlips(r.runId)} className="text-primary font-semibold hover:underline">View slips</button>
              <IconButton icon={<Trash2 className="w-3.5 h-3.5" />} title="Delete run" tone="hover:text-red-600" onClick={() => delRun(r)} />
            </div>
          </div>
        ))}
        <Pagination page={runPg.page} totalPages={runPg.totalPages} total={runPg.total} from={runPg.from} to={runPg.to} onPage={runPg.setPage} />
      </SectionCard>

      {/* Detail slip (modal sederhana) */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setDetail(null)}>
          <div className="bg-card rounded-xl border border-border p-5 w-full max-w-md max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3"><p className="font-bold text-sm">Slip {detail.name} · {detail.period}</p><div className="flex items-center gap-3"><button onClick={() => printSlip(detail)} className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><Download className="w-3.5 h-3.5" />Print / PDF</button><button onClick={() => setDetail(null)}><X className="w-4 h-4" /></button></div></div>
            <div className="text-xs space-y-1 mb-3 text-muted-foreground">
              {detail.detail && Object.entries(detail.detail.metrics).map(([k, v]) => <div key={k} className="flex justify-between"><span>{METRIC_LABEL[k] || k}</span><span className="font-mono">{fmtMetricVal(k, v)}</span></div>)}
            </div>
            <div className="border-t border-border pt-2 space-y-1 text-sm">
              <div className="flex justify-between"><span>Base Salary</span><span className="font-mono">{fmt(detail.base_salary)}</span></div>
              {detail.detail?.lines.map((l: any, i: number) => <div key={i} className={`flex justify-between gap-2 ${l.type === "earning" ? "text-emerald-600" : "text-red-600"}`}><span>{l.name}{l.note ? <span className="text-muted-foreground text-[11px] ml-1">· {l.note}</span> : ""}</span><span className="font-mono whitespace-nowrap">{l.type === "earning" ? "+" : "−"}{fmt(l.amount)}</span></div>)}
              <div className="flex justify-between font-bold border-t border-border pt-1.5 mt-1.5"><span>Net Pay</span><span className="font-mono">{fmt(detail.net)}</span></div>
              {currency !== baseCur && latestRate[currency] && <p className="text-[10px] text-muted-foreground pt-1">Kurs 1 {currency} = {fmtMoney(latestRate[currency], baseCur)}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Preview / konfirmasi sebelum proses payroll (run bersifat permanen). */}
      <AlertDialog open={confirmRun} onOpenChange={setConfirmRun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Payroll Run</AlertDialogTitle>
            <AlertDialogDescription>Review first. Slips are computed automatically from this period's attendance + active components & rules.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-muted-foreground">Period</span><b className="font-mono">{period}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Salary components</span><b>{comps.length}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Automatic rules</span><b>{rules.length}</b></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Base currency</span><b>{baseCur}</b></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={runNow}>{busy ? "Processing…" : "Confirm & Run"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {confirmNode}
    </div>
  );
}

// Modul Manajemen Kurs (admin) — nilai tukar harian untuk konversi slip gaji.
function KursTab({ token }: { token: string }) {
  const today = localYMD();
  const [form, setForm] = useState({ currency: "", rate: 0, date: today });
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const { ask, confirmNode } = useConfirm();
  const dirty = !!editId || form.currency.trim() !== "" || Number(form.rate) > 0;
  const { data: ratesData, error: loadErr, reload } = usePolledData(() => api.exchangeRates(token), { paused: dirty });
  const rates = ratesData ?? [];
  const pg = usePagination(rates);
  const { data: baseCurData } = usePolledData(() => api.companySettings(token).then(s => s.base_currency || "IDR"));
  const baseCur = baseCurData ?? "IDR"; // mata uang dasar perusahaan
  const reset = () => { setEditId(null); setForm({ currency: "", rate: 0, date: today }); };
  const save = async () => {
    const v = exchangeRateSchema.safeParse(form); if (!v.success) { setErr(Object.values(zodErrors(v.error))[0] || "Invalid input"); return; }
    setBusy(true); setErr("");
    try {
      const body = { currency: form.currency.toUpperCase(), rate: Number(form.rate), date: form.date };
      if (editId) await api.updateExchangeRate(token, editId, body); else await api.createExchangeRate(token, body);
      reset(); reload();
    }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const openEdit = (r: ExchangeRate) => { setEditId(r.id); setForm({ currency: r.currency, rate: r.rate, date: r.date }); setErr(""); };
  const del = (r: ExchangeRate) => ask({ title: "Delete exchange rate?", body: `Remove the ${r.currency} rate dated ${r.date}?`, onConfirm: () => api.deleteExchangeRate(token, r.id).then(reload) });
  const latest: Record<string, ExchangeRate> = {};
  for (const r of rates) if (!latest[r.currency]) latest[r.currency] = r;
  return (
    <div className="space-y-4">
      <TabIntro title="Exchange Rates" subtitle={`Daily rates for multi-currency payslip conversion · base ${baseCur}`} />
      {(err || loadErr) && <ErrorBanner>{err || loadErr}</ErrorBanner>}
      <SectionCard title={editId ? "Edit rate" : "Add rate"} icon={<RotateCcw className="w-4 h-4" />} bodyClassName="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Currency"><input className={fieldInput + " w-28 uppercase"} placeholder="USD" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))} /></Field>
          <Field label={`Rate (1 unit = ${baseCur})`}><input type="number" className={fieldInput + " w-40"} placeholder="16000" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: Number(e.target.value) }))} /></Field>
          <Field label="Date"><input type="date" className={fieldInput} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></Field>
          <button disabled={busy} onClick={save} className={btnPrimary}>{editId ? "Update Rate" : "Save Rate"}</button>
          {editId && <button onClick={reset} className={btnGhost}>Cancel</button>}
        </div>
        <p className="text-xs text-muted-foreground">Enter the official rate (e.g. mid-market). Payslip conversion uses the latest rate per currency, relative to the base currency. <b>1 {form.currency || "USD"} = {form.rate ? fmtMoney(Number(form.rate), baseCur) : `… ${baseCur}`}</b></p>
        {Object.values(latest).length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.values(latest).map(r => (
              <span key={r.currency} className="text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary font-semibold">1 {r.currency} = {fmtMoney(r.rate, baseCur)} <span className="opacity-60 font-normal">({r.date})</span></span>
            ))}
          </div>
        )}
      </SectionCard>
      <SectionCard title="Rate history" subtitle={ratesData ? `${rates.length} total` : undefined} bodyClassName="p-0">
        {!ratesData ? <TableSkeleton rows={4} cols={4} /> : rates.length === 0 ? (
          <EmptyState icon={<RotateCcw className="w-5 h-5" />} title="No rates yet" hint="Add an exchange rate above to enable multi-currency payslips." />
        ) : (
          <>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-muted/20">{["Date", "Currency", `Rate (${baseCur})`, ""].map(h => <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {pg.pageItems.map(r => (
                  <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-mono">{r.date}</td><td className="px-4 py-2.5 font-semibold">{r.currency}</td><td className="px-4 py-2.5 font-mono">{fmtMoney(r.rate, baseCur)}</td>
                    <td className="px-4 py-2.5"><div className="flex items-center gap-1 justify-end"><IconButton icon={<Pencil className="w-4 h-4" />} title="Edit" onClick={() => openEdit(r)} /><IconButton icon={<Trash2 className="w-4 h-4" />} title="Delete" tone="hover:text-red-600" onClick={() => del(r)} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 pb-3 pt-1"><Pagination page={pg.page} totalPages={pg.totalPages} total={pg.total} from={pg.from} to={pg.to} onPage={pg.setPage} /></div>
          </>
        )}
      </SectionCard>
      {confirmNode}
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

// Hook data SERAGAM untuk semua tab kontrol — menggantikan pola load/useEffect/
// setInterval yang dulu ditulis ulang di tiap tab (sumber duplikasi & refresh tak
// konsisten). Fetch saat mount, poll berkala, `reload()` manual pasca-mutasi, dan
// JEDA polling saat `paused` (mis. form/modal terbuka) supaya tak menimpa input
// yang sedang diisi ("form ke-reset" / "data berubah lalu balik").
function usePolledData<T>(fetcher: () => Promise<T>, opts: { intervalMs?: number; paused?: boolean; enabled?: boolean } = {}) {
  const { intervalMs = POLL_MS, paused = false, enabled = true } = opts;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const fRef = useRef(fetcher);
  fRef.current = fetcher;
  const reload = useCallback(async () => {
    try { setData(await fRef.current()); setError(""); }
    catch (e: any) { setError(e?.message || String(e)); }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    reload();              // selalu segar saat tab dibuka
    if (paused) return;    // jangan poll saat sedang berinteraksi (form/modal)
    const id = setInterval(reload, intervalMs);
    return () => clearInterval(id);
  }, [reload, paused, enabled, intervalMs]);
  return { data, error, reload, setData };
}

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
  // restoring = sedang memvalidasi token tersimpan saat reload → tampilkan skeleton,
  // BUKAN layar login (cegah "kedip ke login" tiap refresh).
  const [restoring, setRestoring] = useState(() => {
    try { return enabled && !!localStorage.getItem("zylora.control.token"); } catch { return false; }
  });
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
      const today = localYMD();
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
  const login = useCallback(async (email: string, password: string, remember = true) => {
    const r = await api.controlLogin(email.trim(), password);
    tokenRef.current = r.token;
    setToken(r.token);
    setAuthed(true);
    toast.success("Signed in to Control System");
    setError(null);
    try {
      if (remember) { localStorage.setItem("zylora.control.token", r.token); localStorage.setItem("zylora.control.email", email.trim()); }
      else { localStorage.removeItem("zylora.control.token"); localStorage.removeItem("zylora.control.email"); }
    } catch { /* storage diblokir */ }
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
    try { localStorage.removeItem("zylora.control.token"); } catch { /* abaikan */ }
  }, []);

  // Pulihkan sesi dari token tersimpan saat halaman di-refresh (validasi dulu;
  // bila token kedaluwarsa/invalid → bersihkan & tetap di layar login).
  useEffect(() => {
    if (!enabled) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("zylora.control.token"); } catch { /* abaikan */ }
    if (!saved) { setRestoring(false); return; }
    tokenRef.current = saved;
    api.company(saved)
      .then(() => { setToken(saved); setAuthed(true); refresh(); })
      .catch(() => { tokenRef.current = null; try { localStorage.removeItem("zylora.control.token"); } catch { /* abaikan */ } })
      .finally(() => setRestoring(false));
  }, [enabled, refresh]);

  // Polling hanya setelah login.
  useEffect(() => {
    if (!enabled || !authed) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [enabled, authed, refresh]);

  const approveLeave = useCallback(async (id: string) => {
    try { await api.approveLeave(tokenRef.current!, id, true); toast.success("Leave approved"); } catch (e: any) { setError(e?.message ?? String(e)); toast.error(e?.message || "Failed to approve"); }
    await refresh();
  }, [refresh]);

  const rejectLeave = useCallback(async (id: string) => {
    try { await api.approveLeave(tokenRef.current!, id, false); toast("Leave rejected"); } catch (e: any) { setError(e?.message ?? String(e)); toast.error(e?.message || "Failed to reject"); }
    await refresh();
  }, [refresh]);

  const deleteLeave = useCallback(async (id: string) => {
    try { await api.deleteLeave(tokenRef.current!, id); toast.success("Leave request deleted"); } catch (e: any) { setError(e?.message ?? String(e)); toast.error(e?.message || "Failed to delete"); }
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
    toast.success(soft ? "Employee deactivated" : "Employee deleted");
  }, [refresh]);
  const resetEmployeeCode = useCallback(async (id: string) => {
    await api.resetEmployeeCode(tokenRef.current!, id);
    delete codeCache.current[id]; await refresh();
  }, [refresh]);

  // Lokasi (QR per-lokasi dikelola langsung di LokasiTab via api.*; daftar lokasi
  // di-refresh oleh polling panel). CRUD penuh: tambah/ubah/hapus.
  const createLocation = useCallback(async (body: LocationInput) => {
    await api.createLocation(tokenRef.current!, body); await refresh();
  }, [refresh]);
  const updateLocation = useCallback(async (id: string, body: LocationInput) => {
    await api.updateLocation(tokenRef.current!, id, body); await refresh();
    toast.success("Location updated");
  }, [refresh]);
  const deleteLocation = useCallback(async (id: string) => {
    await api.deleteLocation(tokenRef.current!, id); await refresh();
    toast.success("Location deleted");
  }, [refresh]);

  return {
    attendance, leaveRequests, employees, locations, connected, error,
    authed, restoring, token, login, logout,
    approveLeave, rejectLeave, deleteLeave,
    createEmployee, updateEmployee, deleteEmployee, resetEmployeeCode,
    createLocation, updateLocation, deleteLocation,
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
  const [fs, setFs] = useState(false);
  const REFRESH_S = 4;
  const [tick, setTick] = useState(REFRESH_S);

  // Display kiosk dikonfigurasi per-deployment dengan lokasi/perusahaan yang
  // ditampilkannya (multi-tenant: endpoint publik menolak tanpa scope).
  const DISPLAY_LOCATION_ID = (import.meta as any).env?.VITE_LOCATION_ID || "";
  const DISPLAY_COMPANY_ID = (import.meta as any).env?.VITE_COMPANY_ID || "";
  const load = useCallback(async () => {
    if (!DISPLAY_LOCATION_ID && !DISPLAY_COMPANY_ID) {
      setErr("Display not configured — set VITE_LOCATION_ID (or VITE_COMPANY_ID) at build time.");
      return;
    }
    try {
      setLoc(await api.publicLocation(
        DISPLAY_LOCATION_ID ? { location: DISPLAY_LOCATION_ID } : { company: DISPLAY_COMPANY_ID },
      ));
      setErr(null);
    } catch (e: any) { setErr(e?.message || "Failed to load QR"); }
    finally { setTick(REFRESH_S); }
  }, [DISPLAY_LOCATION_ID, DISPLAY_COMPANY_ID]);

  useEffect(() => {
    load();
    // Polling cepat: token sekali-pakai, seri naik tiap scan → QR harus segera
    // diperbarui di layar setelah ada yang memindai.
    const id = setInterval(load, REFRESH_S * 1000);
    return () => clearInterval(id);
  }, [load]);

  // Countdown detik menuju refresh QR berikutnya (indikator "hidup" di kiosk).
  useEffect(() => {
    const id = setInterval(() => setTick(t => (t > 0 ? t - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, []);

  // Mode layar penuh untuk kiosk pintu masuk.
  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFs = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  };

  return (
    <div className="h-screen w-screen bg-[#0D1B2A] text-white flex flex-col items-center justify-center p-8 relative" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="absolute top-6 left-8 flex items-center gap-2 text-white/60 text-sm">
        <Activity className="w-4 h-4 text-accent" />Zylora Absensi
        {!online && <span className="flex items-center gap-1 text-red-400 ml-2"><WifiOff className="w-4 h-4" />No internet</span>}
      </div>
      <div className="absolute top-6 right-8 flex items-center gap-4">
        <div className="font-mono text-4xl font-bold tabular-nums">{fmtTime(now)}</div>
        <button onClick={toggleFs} title={fs ? "Exit fullscreen" : "Fullscreen (kiosk)"} className="p-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 transition-colors">{fs ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}</button>
      </div>

      <p className="text-white/60 text-sm uppercase tracking-widest mb-1">{loc?.name ?? "Attendance Location"}</p>
      <h1 className="text-2xl font-bold mb-6">Scan to Check In</h1>

      <div className="bg-white rounded-3xl p-6 shadow-2xl">
        {loc?.qrImageUrl ? (
          <img src={loc.qrImageUrl} alt="Attendance QR" width={320} height={320} className="block rounded-xl" />
        ) : (
          <div className="w-[320px] h-[320px] flex items-center justify-center text-[#0D1B2A]/40 text-sm">
            {err ? "QR unavailable" : "Loading QR…"}
          </div>
        )}
      </div>

      {loc?.type === "qr_dynamic" && loc.serial != null && (
        <div className="mt-4 text-center">
          <p className="text-white/50 text-xs uppercase tracking-widest">Serial No.</p>
          <p className="font-mono text-3xl font-bold tabular-nums text-accent">#{loc.serial}</p>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 text-sm">
        {loc?.type === "qr_dynamic" ? (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/15 text-accent border border-accent/30">
            <Zap className="w-4 h-4" />Dynamic code · single-use — serial changes per scan
          </span>
        ) : loc ? (
          <span className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-white/70 border border-white/20">
            <QrCode className="w-4 h-4" />Kode statis
          </span>
        ) : null}
      </div>
      <p className="text-white/40 text-xs mt-3">Open the Zylora app on your phone and scan the code above</p>
      <p className="text-white/30 text-[11px] mt-1 flex items-center gap-1.5"><RefreshCw className="w-3 h-3" />Auto-refresh in {tick}s</p>
      {err && <p className="text-red-400 text-xs mt-3">{err}</p>}
      <p className="absolute bottom-6 text-white/30 text-[11px] font-mono">{fmtDate(now)}</p>
      <VersionTag className="absolute bottom-6 right-8 text-white/25 text-[11px] font-mono" />
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
  const { attendance, leaveRequests, employees, locations, authed, restoring, token, connected, login, logout,
    approveLeave, rejectLeave, deleteLeave, createEmployee, updateEmployee, deleteEmployee, resetEmployeeCode,
    createLocation, updateLocation, deleteLocation } = useBackendData(APP_ROLE === "control");

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
          <h2 className="text-white font-bold text-lg mb-2">Control System is Desktop-only</h2>
          <p className="text-white/60 text-sm">The admin panel isn't available on the phone/Android app. Open the Zylora Control System <b>desktop</b> app (Windows/macOS/Linux).</p>
        </div>
      </div>
    );
  }
  // Saat reload + ada token tersimpan: tampilkan skeleton selama validasi token,
  // BUKAN layar login (memperbaiki "tiap refresh balik ke login").
  if (APP_ROLE === "control" && restoring && !authed) return <ControlSkeleton />;
  if (APP_ROLE === "control") return (
    <div className="h-screen overflow-hidden bg-background" style={{ fontFamily: "var(--font-sans)" }}>
      <Toaster richColors position="top-center" />
      <QRLokasiControlPanel attendance={attendance} leaveRequests={leaveRequests}
        onApproveLeave={approveLeave} onRejectLeave={rejectLeave} onDeleteLeave={deleteLeave}
        employees={employees} onCreateEmployee={createEmployee} onUpdateEmployee={updateEmployee}
        onDeleteEmployee={deleteEmployee} onResetCode={resetEmployeeCode}
        authed={authed} onLogin={login} onLogout={logout} token={token} connected={connected}
        locations={locations} onCreateLocation={createLocation} onUpdateLocation={updateLocation} onDeleteLocation={deleteLocation}
        qrVariant={qrVariant} setQrVariant={setQrVariant} qrInterval={qrInterval} setQrInterval={setQrInterval} />
    </div>
  );

  // Tanpa VITE_ROLE → JANGAN tampilkan demo. Build nyata (APK/desktop/web) selalu
  // menetapkan peran lewat VITE_ROLE; ini hanya pengaman bila dijalankan polos.
  return (
    <div className="h-screen flex items-center justify-center bg-[#0D1B2A] p-6 text-center" style={{ fontFamily: "var(--font-sans)" }}>
      <div className="max-w-md">
        <div className="w-14 h-14 rounded-2xl bg-[#1B3D72] flex items-center justify-center mx-auto mb-4"><Activity className="w-7 h-7 text-accent" /></div>
        <h2 className="text-white font-bold text-lg mb-2">Zylora Attendance</h2>
        <p className="text-white/60 text-sm">This build has no role set. Run with <code className="text-accent">VITE_ROLE=employee | control | display</code> (see the dev:employee / dev:control / dev:display scripts).</p>
      </div>
    </div>
  );
}
