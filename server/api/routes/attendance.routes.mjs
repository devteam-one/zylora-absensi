// ─── Papan presensi (dashboard admin) ─────────────────────────────────────────
// Presensi karyawan dicatat lewat app karyawan (login sendiri) di
// employee.routes (/api/me/checkin). Endpoint kiosk/terminal lama sudah dihapus
// karena mode terminal tidak dipakai. File ini hanya menyajikan papan presensi.
import { json } from "../lib/http.mjs";
import { all } from "../lib/db.mjs";
import { requireControl } from "../lib/middleware.mjs";
import { todayStrTz, companyTz } from "../lib/attendance-core.mjs";
import { computeMetrics } from "../lib/payroll-core.mjs";

export function register(router) {
  // Rekap kehadiran DETAIL per karyawan untuk satu periode (?period=YYYY-MM).
  // Metrik sama dgn payroll (hadir/telat/menit telat/lembur/alpa/cuti) → satu
  // sumber kebenaran, konsisten dengan slip gaji.
  router.get("/api/attendance/recap", requireControl, (ctx) => {
    const period = /^\d{4}-\d{2}$/.test(ctx.query.period || "")
      ? ctx.query.period
      : todayStrTz(companyTz(ctx.auth.companyId)).slice(0, 7);
    const emps = all(
      "SELECT * FROM employees WHERE company_id = ? AND status = 'active' ORDER BY name",
      ctx.auth.companyId,
    );
    const rows = emps.map((e) => {
      const m = computeMetrics(e, period);
      return {
        employeeId: e.id, name: e.name, position: e.position, department: e.department,
        schedule_in: e.schedule_in, schedule_out: e.schedule_out,
        days_worked: m.days_worked, late_days: m.late_days, late_minutes: m.late_minutes,
        overtime_hours: m.overtime_hours, absent_days: m.absent_days, leave_days: m.leave_days,
      };
    });
    json(ctx.res, 200, { period, employees: rows });
  });

  // Papan presensi hari ini untuk dashboard admin (?date=YYYY-MM-DD).
  router.get("/api/attendance", requireControl, (ctx) => {
    // "Hari ini" dihitung di zona perusahaan agar cocok dengan tanggal saat dicatat.
    const date = ctx.query.date || todayStrTz(companyTz(ctx.auth.companyId));
    const rows = all(
      `SELECT a.*, e.name AS employee_name, e.department FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.company_id = ? AND a.date = ? ORDER BY a.check_in`,
      ctx.auth.companyId, date,
    );
    json(ctx.res, 200, rows.map((r) => ({
      employeeId: r.employee_id, name: r.employee_name, department: r.department,
      date: r.date, check_in: r.check_in, check_out: r.check_out,
      status: r.status, method: r.method,
    })));
  });
}
