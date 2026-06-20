// ─────────────────────────────────────────────────────────────────────────────
// Pembuatan & validasi kode QR/barcode.
//
//  • Statis  : token stabil ber-tanda-tangan, dicetak & ditempel di lokasi.
//  • Dinamis : token berputar tiap interval (hourly/daily). Validasi memeriksa
//              jendela waktu sekarang ± 1 langkah untuk toleransi jeda scan —
//              meniru useDynamicQR di prototipe tapi di-sign di sisi server.
//  • Personal: kode unik per karyawan (ID card).
//
// Gambar QR memakai layanan eksternal api.qrserver.com, identik dengan prototipe.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from "node:crypto";
import { genId, nowMs } from "./security.mjs";

const SECRET = process.env.ZYLORA_SECRET || "zylora-dev-secret-change-me";

const sig = (data) =>
  createHmac("sha256", SECRET).update(data).digest("hex").slice(0, 10).toUpperCase();

// Lebar satu jendela waktu (ms) berdasarkan interval.
function windowMs(interval) {
  return interval === "daily" ? 86_400_000 : 3_600_000; // default hourly
}

// Indeks jendela waktu untuk timestamp tertentu.
function windowIndex(interval, ms = nowMs()) {
  return Math.floor(ms / windowMs(interval));
}

// URL gambar QR (PNG) untuk token apa pun.
export function qrImageUrl(token, size = 240) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(token)}`;
}

// Token QR statis untuk sebuah lokasi — tetap selama kode belum di-regenerasi.
export function staticToken(locationId) {
  const nonce = genId("s").slice(2, 12);
  return `ZYL-LOC-${locationId}-${nonce}-${sig(`static:${locationId}:${nonce}`)}`;
}

// Token QR dinamis untuk jendela waktu saat ini.
export function dynamicToken(locationId, interval = "hourly", ms = nowMs()) {
  const w = windowIndex(interval, ms);
  return `ZYL-DYN-${locationId}-${w}-${sig(`dyn:${locationId}:${interval}:${w}`)}`;
}

// Validasi token dinamis: cocok jika sesuai jendela sekarang atau satu jendela
// sebelumnya (toleransi karyawan yang scan tepat saat pergantian).
export function isValidDynamicToken(token, locationId, interval = "hourly", ms = nowMs()) {
  const wNow = windowIndex(interval, ms);
  for (const w of [wNow, wNow - 1]) {
    const expected = `ZYL-DYN-${locationId}-${w}-${sig(`dyn:${locationId}:${interval}:${w}`)}`;
    if (token === expected) return true;
  }
  return false;
}

// Kode personal karyawan (di-tanda-tangani agar tak bisa ditebak).
export function employeeCode(employeeId, format = "qr") {
  const nonce = genId("e").slice(2, 10);
  const prefix = format === "barcode" ? "ZYL-BC" : "ZYL-EMP";
  return `${prefix}-${employeeId}-${nonce}-${sig(`emp:${employeeId}:${nonce}`)}`;
}
