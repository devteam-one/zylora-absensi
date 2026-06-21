// ─── Autentikasi & self-service KARYAWAN (JWT peran 'employee') ────────────────
// App karyawan login sebagai dirinya sendiri dan TIDAK pernah memegang token
// admin. Token karyawan hanya bisa mengakses /api/me/* (lihat requireEmployee +
// requireControl di middleware). Identitas saat check-in diambil dari token, jadi
// kode personal tak perlu dikirim dari klien.
import { json, noContent, ApiError } from "../lib/http.mjs";
import { requireFields } from "../lib/validate.mjs";
import { get, run } from "../lib/db.mjs";
import { signJWT, verifyPassword, nowISO } from "../lib/security.mjs";
import { requireEmployee, rateLimit } from "../lib/middleware.mjs";
import {
  resolveLocation, checkGeo, recordCheckin, recordCheckout, todayStatus,
} from "../lib/attendance-core.mjs";

const TOKEN_TTL = 60 * 60 * 12; // 12 jam

// Profil karyawan saat ini (dari token).
function meEmployee(ctx) {
  const emp = get("SELECT * FROM employees WHERE id = ?", ctx.auth.employeeId);
  if (!emp || emp.status !== "active") throw new ApiError(403, "Akun karyawan nonaktif", "INACTIVE");
  return emp;
}

export function register(router) {
  // Login karyawan (ID + PIN/password) → token peran 'employee'.
  router.post("/api/employee/login", rateLimit({ max: 20 }), (ctx) => {
    const b = ctx.body;
    requireFields(b, ["employeeId", "password"]);
    // Terima ID karyawan ATAU email (lebih ramah dari ID acak emp_xxx).
    const ident = String(b.employeeId).trim();
    const emp = get("SELECT * FROM employees WHERE id = ? OR (email IS NOT NULL AND lower(email) = lower(?))", ident, ident);
    if (!emp || !emp.password_hash || !verifyPassword(b.password, emp.password_hash)) {
      throw new ApiError(401, "ID karyawan atau PIN salah", "BAD_CREDENTIALS");
    }
    if (emp.status !== "active") throw new ApiError(403, "Akun karyawan nonaktif", "INACTIVE");

    const { token, jti, exp, expSec } = signJWT(
      { sub: emp.id, cid: emp.company_id, role: "employee" }, TOKEN_TTL,
    );
    run(
      "INSERT INTO sessions (jti, subject_type, subject_id, company_id, expires_at, revoked) VALUES (?,?,?,?,?,0)",
      jti, "employee", emp.id, emp.company_id, new Date(exp * 1000).toISOString(),
    );
    json(ctx.res, 200, { token, expires_in: expSec, employeeId: emp.id, name: emp.name });
  });

  // Logout karyawan → revoke token saat ini.
  router.post("/api/employee/logout", requireEmployee, (ctx) => {
    run("UPDATE sessions SET revoked = 1 WHERE jti = ?", ctx.auth.jti);
    noContent(ctx.res);
  });

  // Profil + kode personal + status presensi hari ini.
  router.get("/api/me", requireEmployee, (ctx) => {
    const emp = meEmployee(ctx);
    const code = get("SELECT code, image_url FROM employee_codes WHERE employee_id = ?", emp.id);
    json(ctx.res, 200, {
      employeeId: emp.id, name: emp.name, position: emp.position, department: emp.department,
      schedule: { in: emp.schedule_in, out: emp.schedule_out },
      code: code?.code || null, codeImageUrl: code?.image_url || null,
      today: todayStatus(emp.id),
    });
  });

  // Check-in oleh karyawan (identitas dari token; tak perlu kirim kode).
  router.post("/api/me/checkin", requireEmployee, (ctx) => {
    const emp = meEmployee(ctx);
    requireFields(ctx.body, ["location_token"]);
    const loc = resolveLocation(ctx.body.location_token);
    checkGeo(loc, ctx.body.lat, ctx.body.lng);
    json(ctx.res, 201, recordCheckin(emp, loc, {
      lat: ctx.body.lat, lng: ctx.body.lng, method: ctx.body.method || "qr_lokasi",
    }));
  });

  // Check-out oleh karyawan.
  router.post("/api/me/checkout", requireEmployee, (ctx) => {
    const emp = meEmployee(ctx);
    requireFields(ctx.body, ["location_token"]);
    const loc = resolveLocation(ctx.body.location_token); // validasi token + bump seri
    json(ctx.res, 200, recordCheckout(emp, loc));
  });
}
