// ─── 1. Registrasi & Autentikasi ─────────────────────────────────────────────
// /api/control/register, /api/control/login, /api/control/logout, /api/company/register
import { json, noContent, ApiError } from "../lib/http.mjs";
import { requireFields, isEmail, assert } from "../lib/validate.mjs";
import { get, run, tx } from "../lib/db.mjs";
import { genId, hashPassword, verifyPassword, signJWT, nowISO } from "../lib/security.mjs";
import { requireAuth, requireControl, rateLimit, audit } from "../lib/middleware.mjs";

const TOKEN_TTL = 60 * 60 * 8; // 8 jam

export function register(router) {
  // Daftar admin + perusahaan sekaligus (transaksi).
  router.post("/api/control/register", rateLimit({ max: 10 }), (ctx) => {
    const b = ctx.body;
    requireFields(b, ["name", "email", "password", "company_name"]);
    assert(isEmail(b.email), 400, "Format email tidak valid");
    assert(String(b.password).length >= 8, 400, "Password minimal 8 karakter");
    if (get("SELECT 1 FROM admins WHERE email = ?", b.email)) {
      throw new ApiError(409, "Email sudah terdaftar", "EMAIL_TAKEN");
    }

    const adminId = genId("adm");
    const companyId = genId("co");
    tx(() => {
      run(
        "INSERT INTO companies (id, name, address, contact_email, created_at) VALUES (?,?,?,?,?)",
        companyId, b.company_name, b.company_address || null, b.email, nowISO(),
      );
      run(
        "INSERT INTO admins (id, company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)",
        adminId, companyId, b.name, b.email, hashPassword(b.password), "control", nowISO(),
      );
    });
    json(ctx.res, 201, { adminId, companyId });
  });

  // Login → JWT + catat sesi (untuk revoke saat logout). Dua lapis rate-limit:
  // per-IP (membatasi 1 sumber) + per-email (meredam serangan yang merotasi IP).
  router.post("/api/control/login",
    rateLimit({ max: 20 }),
    rateLimit({ max: 10, by: (ctx) => `acct:${String(ctx.body?.email || "").trim().toLowerCase()}` }),
    (ctx) => {
    const b = ctx.body;
    requireFields(b, ["email", "password"]);
    const admin = get("SELECT * FROM admins WHERE email = ?", b.email);
    // Pesan seragam agar tak membocorkan email mana yang terdaftar.
    if (!admin || !verifyPassword(b.password, admin.password_hash)) {
      throw new ApiError(401, "Email atau password salah", "BAD_CREDENTIALS");
    }
    const { token, jti, exp, expSec } = signJWT(
      { sub: admin.id, cid: admin.company_id, role: admin.role }, TOKEN_TTL,
    );
    run(
      "INSERT INTO sessions (jti, subject_type, subject_id, company_id, expires_at, revoked) VALUES (?,?,?,?,?,0)",
      jti, "control", admin.id, admin.company_id, new Date(exp * 1000).toISOString(),
    );
    json(ctx.res, 200, { token, expires_in: expSec });
  });

  // Logout → revoke jti sesi saat ini.
  router.post("/api/control/logout", requireAuth, (ctx) => {
    run("UPDATE sessions SET revoked = 1 WHERE jti = ?", ctx.auth.jti);
    audit(ctx, "control.logout");
    noContent(ctx.res);
  });

  // Daftar perusahaan tambahan (multi-company) — butuh admin yang sudah login.
  router.post("/api/company/register", requireControl, (ctx) => {
    const b = ctx.body;
    requireFields(b, ["company_name"]);
    const companyId = genId("co");
    run(
      "INSERT INTO companies (id, name, address, contact_email, industry, created_at) VALUES (?,?,?,?,?,?)",
      companyId, b.company_name, b.address || null, b.contact_email || null, b.industry || null, nowISO(),
    );
    audit(ctx, "company.register", { companyId });
    json(ctx.res, 201, { companyId });
  });
}
