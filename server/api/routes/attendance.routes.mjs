// ─── Papan presensi (dashboard admin) ─────────────────────────────────────────
// Presensi karyawan dicatat lewat app karyawan (login sendiri) di
// employee.routes (/api/me/checkin). Endpoint kiosk/terminal lama sudah dihapus
// karena mode terminal tidak dipakai. File ini hanya menyajikan papan presensi.
import { json } from "../lib/http.mjs";
import { all } from "../lib/db.mjs";
import { requireControl } from "../lib/middleware.mjs";
import { todayStrTz, companyTz } from "../lib/attendance-core.mjs";

export function register(router) {
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
