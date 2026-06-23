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
import { genId, nowMs, SECRET } from "./security.mjs";

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

// Basis layanan gambar QR. Default api.qrserver.com (seperti prototipe), TAPI
// bisa di-arahkan ke instans self-host via ZYLORA_QR_BASE agar token tak melewati
// pihak ketiga di produksi (mis. self-host goqr/qrserver, atau gateway internal).
const QR_IMG_BASE = process.env.ZYLORA_QR_BASE || "https://api.qrserver.com/v1/create-qr-code/";

// URL gambar QR (PNG) untuk token apa pun.
export function qrImageUrl(token, size = 240) {
  const sep = QR_IMG_BASE.includes("?") ? "&" : "?";
  return `${QR_IMG_BASE}${sep}size=${size}x${size}&data=${encodeURIComponent(token)}`;
}

// Token QR statis untuk sebuah lokasi — tetap selama kode belum di-regenerasi.
export function staticToken(locationId) {
  const nonce = genId("s").slice(2, 12);
  return `ZYL-LOC-${locationId}-${nonce}-${sig(`static:${locationId}:${nonce}`)}`;
}

// Token QR dinamis untuk jendela waktu saat ini + nomor seri (anti-replay).
// Format: ZYL-DYN-<loc>-<window>-S<serial>-<sig>. Seri naik tiap scan sehingga
// token yang sudah dipindai jadi tak valid (lihat isValidDynamicToken).
export function dynamicToken(locationId, interval = "hourly", serial = 0, ms = nowMs()) {
  const w = windowIndex(interval, ms);
  return `ZYL-DYN-${locationId}-${w}-S${serial}-${sig(`dyn:${locationId}:${interval}:${w}:${serial}`)}`;
}

// Validasi token dinamis: cocok jika jendela sekarang/sebelumnya (toleransi
// pergantian jam) DAN seri == seri aktif kode (sekali pakai).
export function isValidDynamicToken(token, locationId, interval = "hourly", serial = 0, ms = nowMs()) {
  const wNow = windowIndex(interval, ms);
  for (const w of [wNow, wNow - 1]) {
    const expected = `ZYL-DYN-${locationId}-${w}-S${serial}-${sig(`dyn:${locationId}:${interval}:${w}:${serial}`)}`;
    if (token === expected) return true;
  }
  return false;
}

// Ekstrak nomor seri dari token dinamis (untuk pesan/diagnostik). null bila bukan.
export function serialOf(token) {
  const m = typeof token === "string" && token.match(/-S(\d+)-/);
  return m ? Number(m[1]) : null;
}

// Kode personal karyawan (di-tanda-tangani agar tak bisa ditebak).
export function employeeCode(employeeId, format = "qr") {
  const nonce = genId("e").slice(2, 10);
  const prefix = format === "barcode" ? "ZYL-BC" : "ZYL-EMP";
  return `${prefix}-${employeeId}-${nonce}-${sig(`emp:${employeeId}:${nonce}`)}`;
}
