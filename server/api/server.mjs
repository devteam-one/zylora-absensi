// ─────────────────────────────────────────────────────────────────────────────
// Backend Zylora — entry point.
//
// REST API absensi QR/barcode sungguhan (auth JWT, RBAC, persistensi SQLite),
// menggantikan mock React state di prototipe. Dibangun di atas node:http murni
// tanpa dependency, sejalan dengan server/sync-server.mjs.
//
//   node server/api/server.mjs           # default 127.0.0.2:5181
//   ZYLORA_PORT=5181 ZYLORA_SECRET=... node server/api/server.mjs
//
// Endpoint diaktifkan modular dari routes/*.mjs (lihat routes/index.mjs).
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Router, json } from "./lib/http.mjs";
import { registerAll } from "./routes/index.mjs";
import { seedIfEmpty } from "./seed.mjs";
import { cleanupExpired } from "./lib/db.mjs";
import { sweepRateLimitBuckets } from "./lib/middleware.mjs";

const IS_PROD =
  process.env.NODE_ENV === "production" || process.env.ZYLORA_ENV === "production";
const AUDIT_RETENTION_DAYS = Number(process.env.ZYLORA_AUDIT_RETENTION_DAYS) || 180;

const PORT = Number(process.env.ZYLORA_PORT) || 5181;
// 127.0.0.2: konsisten dengan host dua-port frontend & sync-server.
const HOST = process.env.ZYLORA_HOST || "127.0.0.2";

// SQLite (db.mjs) adalah SATU-SATUNYA backend. Dukungan Postgres dihapus (adapter
// db-pg.mjs tak pernah tersambung & akan korup bila dipakai). Bila ZYLORA_DATABASE_URL
// di-set, operator mungkin mengira data tersimpan di Postgres, padahal app menulis ke
// SQLite lokal (gitignored) → jebakan durabilitas data senyap. Tolak start agar
// kekeliruan ini terlihat keras, bukan menelan data diam-diam.
if (process.env.ZYLORA_DATABASE_URL || process.env.DATABASE_URL) {
  console.error(
    "[zylora] FATAL: ZYLORA_DATABASE_URL/DATABASE_URL di-set, tetapi backend Postgres TIDAK didukung " +
    "(server hanya memakai SQLite via db.mjs). Agar data tidak diam-diam masuk ke SQLite lokal, server menolak start.\n" +
    "  → Hapus variabel tersebut untuk memakai SQLite.",
  );
  process.exit(1);
}

// Identitas versi (sumber tunggal version.json). Saat deploy disalin ke samping
// server.mjs; saat dev dibaca dari root repo. Fallback aman bila tak ada.
const HERE = dirname(fileURLToPath(import.meta.url));
function loadVersion() {
  for (const p of [join(HERE, "version.json"), join(HERE, "../../version.json")]) {
    try { return JSON.parse(readFileSync(p, "utf8")); } catch { /* coba berikutnya */ }
  }
  return { name: "Zylora", product: "Zylora Absensi & HRIS", version: process.env.ZYLORA_VERSION || "1.0.0", channel: "stable", apiContract: "v1" };
}
const VERSION = loadVersion();
const BUILD = {
  commit: VERSION.commit || process.env.ZYLORA_COMMIT || "unknown",
  date: VERSION.buildDate || process.env.ZYLORA_BUILD_DATE || null,
};
const STARTED_AT = new Date().toISOString();

const router = Router();

// Health check (tanpa auth) — ringkas, untuk probe/uptime monitor.
router.get("/health", (ctx) => json(ctx.res, 200, { ok: true, service: "zylora-api", version: VERSION.version }));

// Identitas versi lengkap (tanpa auth) — untuk cek kompatibilitas klien & audit.
router.get("/api/version", (ctx) => json(ctx.res, 200, {
  name: VERSION.name, product: VERSION.product, version: VERSION.version,
  channel: VERSION.channel, apiContract: VERSION.apiContract,
  commit: BUILD.commit, buildDate: BUILD.date,
  startedAt: STARTED_AT, uptimeSec: Math.round(process.uptime()),
}));

registerAll(router);

// Seed demo HANYA bila ZYLORA_SEED=1 (default OFF). Produksi mulai BERSIH —
// daftarkan perusahaan/admin asli via POST /api/control/register lalu tambah
// karyawan & lokasi lewat Panel Kontrol. ZYLORA_SEED=1 dipakai dev/lokal saja.
const seeded = process.env.ZYLORA_SEED === "1" ? seedIfEmpty() : null;
if (seeded) {
  // Di dev cetak kredensial demo (praktis); di produksi JANGAN bocorkan password
  // ke log (bisa terkirim ke logging terpusat). Seed di prod memang tak dianjurkan.
  if (IS_PROD) {
    console.warn(`[zylora] seed demo AKTIF di produksi (ZYLORA_SEED=1) — tidak dianjurkan. Kredensial tidak dicetak; lihat seed.mjs.`);
  } else {
    console.log(`[zylora] seeded demo data → sistem kontrol: ${seeded.controlEmail} / ${seeded.controlPassword} · karyawan: EMP001–EMP008 / PIN ${seeded.employeePin}`);
  }
} else if (process.env.ZYLORA_SEED !== "1") {
  console.log("[zylora] seed demo dimatikan (set ZYLORA_SEED=1 untuk data demo).");
}

// Pembersihan housekeeping: saat start + tiap 6 jam. unref() agar tak menahan
// proses tetap hidup saat shutdown.
function housekeeping() {
  try {
    const c = cleanupExpired({ auditRetentionDays: AUDIT_RETENTION_DAYS });
    sweepRateLimitBuckets();
    if (c.sessions || c.audits) {
      console.log(`[zylora] housekeeping: hapus ${c.sessions} sesi & ${c.audits} audit kedaluwarsa.`);
    }
  } catch (err) {
    console.error("[zylora] housekeeping gagal:", err?.message || err);
  }
}
housekeeping();
setInterval(housekeeping, 6 * 60 * 60 * 1000).unref();

const server = http.createServer((req, res) => {
  router.handle(req, res).catch((err) => {
    console.error("[zylora] fatal:", err);
    if (!res.writableEnded) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "FATAL", message: "Internal error" } }));
    }
  });
});

server.on("error", (err) => {
  console.error(`[zylora] server error: ${err.code || err.message}`);
  if (err.code === "EADDRNOTAVAIL" || err.code === "EADDRINUSE") {
    console.error(`[zylora] gagal bind ${HOST}:${PORT} — set ZYLORA_HOST/ZYLORA_PORT.`);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[zylora] ${VERSION.product} v${VERSION.version} (${VERSION.channel}, ${BUILD.commit}) — REST API listening on http://${HOST}:${PORT}`);
});
