// Validasi input ringkas. Melempar ApiError(400) bila gagal.
import { ApiError } from "./http.mjs";

// Pastikan setiap field di `fields` ada & tidak kosong di `body`.
export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === "");
  if (missing.length) {
    throw new ApiError(400, `Field wajib hilang: ${missing.join(", ")}`, "VALIDATION");
  }
}

// Ambil hanya subset key yang diizinkan (whitelist) dari body — cegah update kolom liar.
export function pick(body, allowed) {
  const out = {};
  for (const k of allowed) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

export function assert(cond, status, message, code = "VALIDATION") {
  if (!cond) throw new ApiError(status, message, code);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(v) {
  return typeof v === "string" && EMAIL_RE.test(v);
}
