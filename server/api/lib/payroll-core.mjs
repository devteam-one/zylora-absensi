// ─────────────────────────────────────────────────────────────────────────────
// Logika perhitungan gaji (payroll) — TERINTEGRASI absensi.
// Menarik metrik dari tabel attendance & leave_requests untuk satu periode bulan
// (YYYY-MM), lalu menerapkan komponen gaji (tetap/berbasis) + aturan otomatis.
// ─────────────────────────────────────────────────────────────────────────────
import { all } from "./db.mjs";
import { todayStr } from "./attendance-core.mjs"; // "hari ini" sadar-zona (ZYLORA_TZ), bukan UTC

const toMin = (hhmm) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const daysInMonth = (period) => { const [y, mo] = period.split("-").map(Number); return new Date(y, mo, 0).getDate(); };
const nextDay = (ds) => { const dt = new Date(ds + "T00:00:00"); dt.setDate(dt.getDate() + 1); return dt.toISOString().slice(0, 10); };

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
      const ci = toMin(r.check_in);
      if (ci != null && ci > schedIn) { late_minutes += ci - schedIn; late_days++; }
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

  // Alpa = hari kerja (Sen-Jum) sampai hari ini tanpa check-in & tanpa cuti disetujui.
  const today = todayStr();
  let absent_days = 0;
  for (let day = 1; day <= dim; day++) {
    const ds = `${period}-${String(day).padStart(2, "0")}`;
    if (ds > today) break;
    const wd = new Date(`${ds}T00:00:00`).getDay(); // 0=Min .. 6=Sab
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
    let amt = 0;
    switch (c.basis) {
      case "fixed": amt = c.value; break;
      case "percent_base": amt = base * c.value / 100; break;
      case "per_late_min": amt = m.late_minutes * c.value; break;
      case "per_absent_day": amt = m.absent_days * c.value; break;
      case "per_overtime_hour": amt = m.overtime_hours * c.value; break;
      default: amt = 0;
    }
    amt = Math.round(amt);
    if (amt === 0) continue;
    if (c.type === "earning") earnings += amt; else deductions += amt;
    lines.push({ name: c.name, type: c.type, basis: c.basis, amount: amt });
  }

  for (const r of rules) {
    if (!r.active) continue;
    const v = ({ late_days: m.late_days, late_minutes: m.late_minutes, overtime_hours: m.overtime_hours, absent_days: m.absent_days, leave_days: m.leave_days })[r.metric] ?? 0;
    const hit = r.op === "gt" ? v > r.threshold : v >= r.threshold;
    if (!hit) continue;
    const amt = Math.round(r.amount);
    if (r.action === "bonus") earnings += amt; else deductions += amt;
    lines.push({ name: r.name, type: r.action === "bonus" ? "earning" : "deduction", basis: "rule", amount: amt, note: `${r.metric} ${r.op} ${r.threshold}` });
  }

  const net = Math.round(base + earnings - deductions);
  return { base_salary: base, earnings, deductions, net, metrics: m, lines };
}
