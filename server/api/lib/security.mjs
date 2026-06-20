// ─────────────────────────────────────────────────────────────────────────────
// Primitif keamanan — semuanya dari `node:crypto` (tanpa bcrypt/jsonwebtoken),
// supaya backend tetap bebas-dependency.
//
//  • Password  : scrypt (KDF lambat & ber-salt) → format "scrypt$salt$hash".
//  • Token     : JWT HS256 buatan sendiri (header.payload.signature, base64url).
//
// Rahasia diambil dari ZYLORA_SECRET. Untuk dev ada fallback tetap supaya token
// tidak invalid tiap restart; WAJIB di-set sendiri di produksi.
// ─────────────────────────────────────────────────────────────────────────────
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHmac,
} from "node:crypto";

const SECRET = process.env.ZYLORA_SECRET || "zylora-dev-secret-change-me";

// ─── ID ───────────────────────────────────────────────────────────────────────
// ID ber-prefix biar enak dibaca di log/respons: emp_xxxx, loc_xxxx, dst.
export function genId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

// ─── Password (scrypt) ─────────────────────────────────────────────────────────
export function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(plain, stored) {
  const [scheme, salt, hash] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(plain, salt, 64);
  // Panjang harus sama sebelum timingSafeEqual, kalau tidak ia melempar.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ─── JWT (HS256) ───────────────────────────────────────────────────────────────
const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlJson = (obj) => b64url(JSON.stringify(obj));

function sign(data) {
  return b64url(createHmac("sha256", SECRET).update(data).digest());
}

// payload: { sub, cid, role, jti }. ttlSec → exp. Mengembalikan { token, jti, exp }.
export function signJWT(payload, ttlSec = 3600) {
  const now = Math.floor(nowMs() / 1000);
  const exp = now + ttlSec;
  const jti = payload.jti || randomUUID();
  const head = b64urlJson({ alg: "HS256", typ: "JWT" });
  const body = b64urlJson({ ...payload, jti, iat: now, exp });
  const sig = sign(`${head}.${body}`);
  return { token: `${head}.${body}.${sig}`, jti, exp, expSec: ttlSec };
}

// Mengembalikan payload bila valid, atau null (tanda tangan salah / kedaluwarsa /
// format rusak). Pengecekan revoke dilakukan di middleware (perlu akses DB).
export function verifyJWT(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;
  const expected = sign(`${head}.${body}`);
  // Bandingkan konstan-waktu.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64").toString());
    if (payload.exp && Math.floor(nowMs() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// new Date()/Date.now() bisa dipakai di runtime backend biasa (bukan workflow
// script), tapi dibungkus agar mudah di-stub saat tes.
export function nowMs() {
  return Date.now();
}
export function nowISO() {
  return new Date().toISOString();
}
