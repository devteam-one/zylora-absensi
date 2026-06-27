// ─── Autentikasi & self-service KARYAWAN (JWT peran 'employee') ────────────────
// App karyawan login sebagai dirinya sendiri dan TIDAK pernah memegang token
// admin. Token karyawan hanya bisa mengakses /api/me/* (lihat requireEmployee +
// requireControl di middleware). Identitas saat check-in diambil dari token, jadi
// kode personal tak perlu dikirim dari klien.
import { json, noContent, ApiError } from "../lib/http.mjs";
import { requireFields } from "../lib/validate.mjs";
import { get, run, all } from "../lib/db.mjs";
import { signJWT, verifyPassword, nowISO, genId } from "../lib/security.mjs";
import { requireEmployee, rateLimit } from "../lib/middleware.mjs";
import {
  resolveLocation, checkGeo, recordCheckin, recordCheckout, todayStatus,
} from "../lib/attendance-core.mjs";

const TOKEN_TTL = 60 * 60 * 12; // 12 jam

// Profil karyawan saat ini (dari token).
function meEmployee(ctx) {
  const emp = get("SELECT * FROM employees WHERE id = ?", ctx.auth.employeeId);
  if (!emp || emp.status !== "active") throw new ApiError(403, "Employee account is inactive", "INACTIVE");
  return emp;
}

export function register(router) {
  // Login karyawan (ID + PIN/password) → token peran 'employee'. Rate-limit
  // dua lapis: per-IP + per-identitas (ID/email) untuk meredam tebak-PIN.
  router.post("/api/employee/login",
    rateLimit({ max: 20 }),
    rateLimit({ max: 10, by: (ctx) => `acct:${String(ctx.body?.employeeId || "").trim().toLowerCase()}` }),
    (ctx) => {
    const b = ctx.body;
    requireFields(b, ["employeeId", "password"]);
    // Terima ID karyawan ATAU email (lebih ramah dari ID acak emp_xxx).
    const ident = String(b.employeeId).trim();
    const emp = get("SELECT * FROM employees WHERE id = ? OR (email IS NOT NULL AND lower(email) = lower(?))", ident, ident);
    if (!emp || !emp.password_hash || !verifyPassword(b.password, emp.password_hash)) {
      throw new ApiError(401, "Wrong employee ID or PIN", "BAD_CREDENTIALS");
    }
    if (emp.status !== "active") throw new ApiError(403, "Employee account is inactive", "INACTIVE");

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
      employeeId: emp.id, companyId: emp.company_id, name: emp.name, position: emp.position, department: emp.department,
      email: emp.email || null, start_date: emp.start_date || null,
      schedule: { in: emp.schedule_in, out: emp.schedule_out },
      code: code?.code || null, codeImageUrl: code?.image_url || null,
      today: todayStatus(emp.id),
    });
  });

  // Slip gaji MILIK SAYA — karyawan melihat laporan gajinya sendiri (read-only).
  router.get("/api/me/payslips", requireEmployee, (ctx) => {
    const rows = all(
      `SELECT period, base_salary, earnings, deductions, net, currency, detail, created_at
       FROM payslips WHERE employee_id = ? ORDER BY period DESC, created_at DESC LIMIT 24`,
      ctx.auth.employeeId,
    );
    json(ctx.res, 200, rows.map((p) => ({
      period: p.period, base_salary: p.base_salary, earnings: p.earnings,
      deductions: p.deductions, net: p.net, currency: p.currency || "IDR",
      detail: p.detail ? JSON.parse(p.detail) : null, created_at: p.created_at,
    })));
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

  // Riwayat presensi SAYA (?start=YYYY-MM-DD&end=YYYY-MM-DD). Identitas dari token,
  // jadi karyawan hanya bisa melihat datanya sendiri.
  router.get("/api/me/attendance", requireEmployee, (ctx) => {
    const where = ["employee_id = ?"];
    const vals = [ctx.auth.employeeId];
    if (ctx.query.start) { where.push("date >= ?"); vals.push(ctx.query.start); }
    if (ctx.query.end) { where.push("date <= ?"); vals.push(ctx.query.end); }
    const rows = all(
      `SELECT date, check_in, check_out, status, method FROM attendance
       WHERE ${where.join(" AND ")} ORDER BY date DESC LIMIT 60`, ...vals,
    );
    json(ctx.res, 200, rows);
  });

  // Daftar pengajuan izin/cuti SAYA.
  router.get("/api/me/leave", requireEmployee, (ctx) => {
    const rows = all(
      `SELECT id, type, start_date, end_date, reason, status, notes, created_at
       FROM leave_requests WHERE employee_id = ? ORDER BY created_at DESC LIMIT 50`,
      ctx.auth.employeeId,
    );
    json(ctx.res, 200, rows.map((r) => ({
      requestId: r.id, type: r.type, start_date: r.start_date, end_date: r.end_date,
      reason: r.reason, status: r.status, notes: r.notes, created_at: r.created_at,
    })));
  });

  // Ajukan izin/cuti sendiri (status awal 'pending' → admin menyetujui di Sistem Kontrol).
  router.post("/api/me/leave", requireEmployee, (ctx) => {
    const emp = meEmployee(ctx); // memastikan akun aktif + ambil company_id
    const b = ctx.body;
    requireFields(b, ["start_date", "end_date"]);
    const type = ["cuti", "izin", "sakit"].includes(b.type) ? b.type : "cuti";
    if (String(b.end_date) < String(b.start_date)) {
      throw new ApiError(400, "End date can't be before start date", "BAD_RANGE");
    }
    const id = genId("leave");
    run(
      `INSERT INTO leave_requests (id, company_id, employee_id, type, start_date, end_date, reason, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, emp.company_id, emp.id, type, b.start_date, b.end_date, b.reason || null, "pending", nowISO(),
    );
    json(ctx.res, 201, { requestId: id, status: "pending" });
  });
}
