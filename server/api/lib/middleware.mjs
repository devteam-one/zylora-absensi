// ─────────────────────────────────────────────────────────────────────────────
// Middleware: autentikasi JWT, kontrol akses berbasis peran (RBAC), rate-limit,
// dan pencatatan audit. Dipasang per-rute di file routes.
// ─────────────────────────────────────────────────────────────────────────────
import { verifyJWT, genId, nowISO, nowMs } from "./security.mjs";
import { get, run } from "./db.mjs";
import { ApiError } from "./http.mjs";

// ─── Autentikasi ─────────────────────────────────────────────────────────────
// Memvalidasi "Authorization: Bearer <jwt>", memastikan sesi belum di-revoke,
// lalu mengisi ctx.auth. Token bisa milik admin ATAU karyawan (peran di JWT).
export function requireAuth(ctx) {
  const header = ctx.req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new ApiError(401, "Missing access token", "NO_TOKEN");

  const payload = verifyJWT(token);
  if (!payload) throw new ApiError(401, "Invalid or expired token", "BAD_TOKEN");

  const session = get(
    "SELECT subject_type, subject_id, company_id, revoked FROM sessions WHERE jti = ?",
    payload.jti,
  );
  if (!session || session.revoked) throw new ApiError(401, "Session has ended", "SESSION_REVOKED");

  // Peran HARUS eksplisit & dikenal — jangan fail-open ke peran berhak (dulu `|| "control"`).
  const role = payload.role;
  if (role !== "control" && role !== "employee") throw new ApiError(401, "Invalid token role", "BAD_TOKEN");

  // Ikat klaim token ke baris sesi yang dicatat saat login. Baris sesi sebelumnya
  // hanya dipakai sebagai penanda "hidup" (revoked); identitas/peran diambil mentah
  // dari JWT — sehingga siapa pun yang bisa menandatangani JWT (mis. ZYLORA_SECRET bocor)
  // dapat memakai ulang jti hidup miliknya dengan role/cid berbeda → eskalasi lintas-tenant.
  const expectedType = role === "employee" ? "employee" : "control";
  if (
    session.subject_type !== expectedType ||
    session.subject_id !== payload.sub ||
    (session.company_id ?? null) !== (payload.cid ?? null)
  ) {
    throw new ApiError(401, "Session identity mismatch", "SESSION_MISMATCH");
  }
  ctx.auth = {
    subjectId: payload.sub,
    subjectType: role === "employee" ? "employee" : "control",
    companyId: payload.cid,
    role,
    jti: payload.jti,
    // operatorId = id operator sistem kontrol (dulu "admin"); dipakai audit/decided_by.
    operatorId: role === "employee" ? null : payload.sub,
    employeeId: role === "employee" ? payload.sub : null,
  };
}

// RBAC: batasi rute hanya untuk peran tertentu. Pakai SETELAH requireAuth.
export function requireRole(...roles) {
  return (ctx) => {
    if (!ctx.auth) throw new ApiError(401, "Not authenticated", "NO_AUTH");
    if (!roles.includes(ctx.auth.role)) {
      throw new ApiError(403, "Access denied for this role", "FORBIDDEN");
    }
  };
}

// Kombinasi praktis: auth + cek peran dalam satu middleware.
// Operator sistem kontrol (peran 'control', dulu 'admin').
export function requireControl(ctx) {
  requireAuth(ctx);
  if (ctx.auth.role !== "control") {
    throw new ApiError(403, "Control-system only endpoint", "FORBIDDEN");
  }
}

export function requireEmployee(ctx) {
  requireAuth(ctx);
  if (ctx.auth.role !== "employee") {
    throw new ApiError(403, "Employee only endpoint", "FORBIDDEN");
  }
}

// ─── Rate-limit (fixed window, in-memory) ────────────────────────────────────
// Cukup untuk melindungi endpoint sensitif (login/register) dari brute force.
// Deploy single-instance (1 EC2) → in-memory memadai. Untuk multi-instance,
// ganti store ke backing bersama. `by(ctx)` memberi kunci kustom (mis. per-akun
// untuk meredam credential-stuffing yang merotasi IP); default per-IP.
const buckets = new Map(); // key -> { count, resetAt }

export function rateLimit({ max = 30, windowMs = 15 * 60 * 1000, by } = {}) {
  return (ctx) => {
    const subject = by ? by(ctx) : `ip:${ctx.ip}`;
    const id = `${ctx.req.method}:${ctx.req.url.split("?")[0]}:${subject}`;
    const now = nowMs();
    let b = buckets.get(id);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(id, b);
    }
    b.count++;
    if (b.count > max) {
      throw new ApiError(429, "Too many requests, try again later", "RATE_LIMITED");
    }
  };
}

// Pembersihan berkala bucket kedaluwarsa agar Map tak tumbuh tanpa batas.
export function sweepRateLimitBuckets() {
  const now = nowMs();
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
}

// ─── Audit log ───────────────────────────────────────────────────────────────
// Catat aksi admin yang mengubah data/konfigurasi (lihat /api/logs).
export function audit(ctx, action, detail = "") {
  run(
    "INSERT INTO audit_logs (id, company_id, admin_id, action, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)",
    genId("log"),
    ctx.auth?.companyId || null,
    ctx.auth?.operatorId || null,
    action,
    typeof detail === "string" ? detail : JSON.stringify(detail),
    ctx.ip,
    nowISO(),
  );
}
