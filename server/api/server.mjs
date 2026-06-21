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
import { Router, json } from "./lib/http.mjs";
import { registerAll } from "./routes/index.mjs";
import { seedIfEmpty } from "./seed.mjs";

const PORT = Number(process.env.ZYLORA_PORT) || 5181;
// 127.0.0.2: konsisten dengan host dua-port frontend & sync-server.
const HOST = process.env.ZYLORA_HOST || "127.0.0.2";

const router = Router();

// Health check (tanpa auth).
router.get("/health", (ctx) => json(ctx.res, 200, { ok: true, service: "zylora-api" }));

registerAll(router);

// Seed demo HANYA bila ZYLORA_SEED=1 (default OFF). Produksi mulai BERSIH —
// daftarkan perusahaan/admin asli via POST /api/control/register lalu tambah
// karyawan & lokasi lewat Panel Kontrol. ZYLORA_SEED=1 dipakai dev/lokal saja.
const seeded = process.env.ZYLORA_SEED === "1" ? seedIfEmpty() : null;
if (seeded) {
  console.log(`[zylora] seeded demo data → sistem kontrol: ${seeded.controlEmail} / ${seeded.controlPassword} · karyawan: EMP001–EMP008 / PIN ${seeded.employeePin}`);
} else if (process.env.ZYLORA_SEED !== "1") {
  console.log("[zylora] seed demo dimatikan (set ZYLORA_SEED=1 untuk data demo).");
}

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
  console.log(`[zylora] REST API listening on http://${HOST}:${PORT}`);
});
