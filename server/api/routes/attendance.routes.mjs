// ─── Presensi via kiosk/terminal (publik) ─────────────────────────────────────
// Terminal di lokasi memindai kode personal (ID card) karyawan lalu mencatat
// presensi. Identitas dibuktikan oleh kode yang dipindai — bukan login. Untuk
// app karyawan (login sendiri) lihat employee.routes (/api/me/checkin).
import { json } from "../lib/http.mjs";
import { requireFields } from "../lib/validate.mjs";
import { all } from "../lib/db.mjs";
import { requireControl } from "../lib/middleware.mjs";
import {
  resolveEmployeeByCode, resolveLocation, checkGeo,
  recordCheckin, recordCheckout, todayStr,
} from "../lib/attendance-core.mjs";

export function register(router) {
  // Kiosk memindai ID card → check-in.
  router.post("/api/attendance/checkin", (ctx) => {
    const b = ctx.body;
    requireFields(b, ["employee_code", "location_token"]);
    const emp = resolveEmployeeByCode(b.employee_code);
    const loc = resolveLocation(b.location_token);
    checkGeo(loc, b.lat, b.lng);
    json(ctx.res, 201, recordCheckin(emp, loc, { lat: b.lat, lng: b.lng, method: b.method }));
  });

  // Kiosk memindai ID card lagi saat pulang → check-out.
  router.post("/api/attendance/checkout", (ctx) => {
    const b = ctx.body;
    requireFields(b, ["employee_code", "location_token"]);
    const emp = resolveEmployeeByCode(b.employee_code);
    const loc = resolveLocation(b.location_token); // validasi token + untuk bump seri
    json(ctx.res, 200, recordCheckout(emp, loc));
  });

  // Papan presensi hari ini untuk dashboard admin (?date=YYYY-MM-DD).
  router.get("/api/attendance", requireControl, (ctx) => {
    const date = ctx.query.date || todayStr();
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
