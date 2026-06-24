// ─── 1. Registrasi & Autentikasi ─────────────────────────────────────────────
// /api/control/register, /api/control/login, /api/control/logout, /api/company/register
import { json, noContent, ApiError } from "../lib/http.mjs";
import { requireFields, isEmail, assert } from "../lib/validate.mjs";
import { get, run, tx } from "../lib/db.mjs";
import { genId, hashPassword, verifyPassword, signJWT, nowISO } from "../lib/security.mjs";
import { requireAuth, requireControl, rateLimit, audit } from "../lib/middleware.mjs";

const TOKEN_TTL = 60 * 60 * 8; // 8 jam

export function register(router) {
  // Self-register publik DIHAPUS (pengerasan keamanan). Akun Sistem Kontrol kini
  // HANYA dibuat lewat shell di server: `node tools/register-admin.mjs ...`.
  // Endpoint dipertahankan tapi selalu menolak, agar klien lama dapat pesan jelas.
  router.post("/api/control/register", (ctx) => {
    throw new ApiError(
      403,
      "Self-registration is disabled. Admin accounts are created by the operator via the server shell.",
      "REGISTRATION_DISABLED",
    );
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
      throw new ApiError(401, "Wrong email or password", "BAD_CREDENTIALS");
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
