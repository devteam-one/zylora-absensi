// ─────────────────────────────────────────────────────────────────────────────
// Logika perhitungan gaji (payroll) — TERINTEGRASI absensi.
// Menarik metrik dari tabel attendance & leave_requests untuk satu periode bulan
// (YYYY-MM), lalu menerapkan komponen gaji (tetap/berbasis) + aturan otomatis.
// ─────────────────────────────────────────────────────────────────────────────
import { all } from "./db.mjs";
import { todayStr, lateMinutes } from "./attendance-core.mjs"; // "hari ini" sadar-zona + telat sadar-shift

const toMin = (hhmm) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
// Date math WAJIB UTC-safe: `new Date("YYYY-MM-DDT00:00:00")` di-parse sebagai waktu
// LOKAL, lalu .toISOString() balik ke UTC — di host TZ offset-positif (mis. Asia/Jakarta,
// UTC+7) +1 hari ter-batalkan sehingga nextDay() tak pernah maju → loop tak terhingga.
// Anchor "Z" + getUTCDate/setUTCDate membuat hasil tak bergantung TZ host.
const daysInMonth = (period) => { const [y, mo] = period.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const nextDay = (ds) => { const dt = new Date(ds + "T00:00:00Z"); dt.setUTCDate(dt.getUTCDate() + 1); return dt.toISOString().slice(0, 10); };

// Metrik absensi karyawan untuk satu periode.
export function computeMetrics(emp, period) {
  const rows = all(
    "SELECT date, check_in, check_out, status FROM attendance WHERE employee_id = ? AND date LIKE ?",
    emp.id, `${period}-%`,
  );
  const schedIn = toMin(emp.schedule_in) ?? 480;   // default 08:00
  const schedOut = toMin(emp.schedule_out) ?? 1020; // default 17:00
  let late_minutes = 0, late_days = 0, overtime_hours = 0, days_worked = 0;
  const datesWithCheckin = new Set();
  for (const r of rows) {
    if (r.check_in) {
      days_worked++; datesWithCheckin.add(r.date);
      const lm = lateMinutes(toMin(r.check_in), schedIn, schedOut); // sadar shift malam
      if (lm > 0) { late_minutes += lm; late_days++; }
    }
    if (r.check_out) {
      const co = toMin(r.check_out);
      if (co != null && co > schedOut) overtime_hours += (co - schedOut) / 60;
    }
  }

  // Cuti/izin DISETUJUI yang menyentuh periode → kumpulkan tanggalnya.
  const dim = daysInMonth(period);
  const periodStart = `${period}-01`;
  const periodEnd = `${period}-${String(dim).padStart(2, "0")}`;
  const leaves = all(
    "SELECT type, start_date, end_date FROM leave_requests WHERE employee_id = ? AND status = 'approved'",
    emp.id,
  );
  const leaveDates = new Set();
  for (const lv of leaves) {
    let d = lv.start_date < periodStart ? periodStart : lv.start_date;
    const end = lv.end_date > periodEnd ? periodEnd : lv.end_date;
    while (d <= end) { leaveDates.add(d); if (d === end) break; d = nextDay(d); }
  }

  // Alpa = hari kerja (Sen-Jum) tanpa check-in & tanpa cuti disetujui, MULAI dari
  // tanggal masuk karyawan (start_date) sampai hari ini — jadi karyawan baru TIDAK
  // dihitung bolos untuk hari sebelum ia bergabung.
  const today = todayStr();
  const joinDate = emp.start_date || null;
  let absent_days = 0;
  for (let day = 1; day <= dim; day++) {
    const ds = `${period}-${String(day).padStart(2, "0")}`;
    if (ds > today) break;
    if (joinDate && ds < joinDate) continue; // sebelum karyawan masuk → bukan alpa
    const wd = new Date(`${ds}T00:00:00Z`).getUTCDay(); // 0=Min .. 6=Sab (UTC-safe)
    if (wd === 0 || wd === 6) continue;
    if (datesWithCheckin.has(ds) || leaveDates.has(ds)) continue;
    absent_days++;
  }

  return {
    late_minutes, late_days,
    overtime_hours: Math.round(overtime_hours * 100) / 100,
    absent_days, leave_days: leaveDates.size, days_worked,
  };
}

// Hitung slip gaji satu karyawan: base + komponen + aturan otomatis.
export function computePayslip(emp, period, components, rules) {
  const m = computeMetrics(emp, period);
  const base = emp.base_salary || 0;
  const lines = [];
  let earnings = 0, deductions = 0;

  for (const c of components) {
    // qty/rate/note → rincian transparan di slip ("235 menit × Rp1.000/menit").
    let amt = 0, qty = null, rate = null, note = "";
    switch (c.basis) {
      case "fixed": amt = c.value; note = "tetap"; break;
      case "percent_base": amt = base * c.value / 100; rate = c.value; note = `${c.value}% × gaji pokok`; break;
      case "per_late_min": qty = m.late_minutes; rate = c.value; amt = qty * rate; note = `${qty} menit telat × ${rate}/menit`; break;
      case "per_absent_day": qty = m.absent_days; rate = c.value; amt = qty * rate; note = `${qty} hari alpa × ${rate}/hari`; break;
      case "per_overtime_hour": qty = m.overtime_hours; rate = c.value; amt = qty * rate; note = `${qty} jam lembur × ${rate}/jam`; break;
      default: amt = 0;
    }
    amt = Math.round(amt);
    if (amt === 0) continue;
    if (c.type === "earning") earnings += amt; else deductions += amt;
    lines.push({ name: c.name, type: c.type, basis: c.basis, amount: amt, qty, rate, note });
  }

  const METRIC_ID = { late_days: "hari telat", late_minutes: "menit telat", overtime_hours: "jam lembur", absent_days: "hari alpa", leave_days: "hari cuti" };
  for (const r of rules) {
    if (!r.active) continue;
    const v = ({ late_days: m.late_days, late_minutes: m.late_minutes, overtime_hours: m.overtime_hours, absent_days: m.absent_days, leave_days: m.leave_days })[r.metric] ?? 0;
    const hit = r.op === "gt" ? v > r.threshold : v >= r.threshold;
    if (!hit) continue;
    const amt = Math.round(r.amount);
    if (r.action === "bonus") earnings += amt; else deductions += amt;
    // Catatan terbaca + nilai aktual: "telat 235 menit (aturan: ≥ 1 menit telat)".
    const op = r.op === "gt" ? ">" : "≥";
    lines.push({ name: r.name, type: r.action === "bonus" ? "earning" : "deduction", basis: "rule", amount: amt, qty: v, rate: null, note: `${v} ${METRIC_ID[r.metric] || r.metric} (aturan: ${op} ${r.threshold})` });
  }

  const net = Math.round(base + earnings - deductions);
  return { base_salary: base, earnings, deductions, net, metrics: m, lines };
}
