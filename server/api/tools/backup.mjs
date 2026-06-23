// ─────────────────────────────────────────────────────────────────────────────
// Backup DB SQLite — zero-dependency (node:sqlite). Memakai "VACUUM INTO" yang
// menghasilkan salinan konsisten secara online (aman walau API sedang menulis,
// berkat WAL) ke berkas ber-timestamp, lalu memangkas backup lama (simpan N).
//
// Dijalankan oleh systemd timer (lihat deploy/zylora-backup.{service,timer}):
//   ZYLORA_DB=/opt/zylora/data/zylora.db \
//   ZYLORA_BACKUP_DIR=/opt/zylora/backups \
//   ZYLORA_BACKUP_KEEP=14 \
//   node /opt/zylora/api/tools/backup.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ZYLORA_DB || resolve(HERE, "../data/zylora.db");
const BACKUP_DIR = process.env.ZYLORA_BACKUP_DIR || resolve(HERE, "../data/backups");
const KEEP = Math.max(1, Number(process.env.ZYLORA_BACKUP_KEEP) || 14);

mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, "-"); // ramah nama berkas
const outFile = join(BACKUP_DIR, `zylora-${stamp}.db`);

// VACUUM INTO butuh literal string; escape kutip tunggal pada path.
const sqlPath = outFile.replace(/'/g, "''");

const db = new DatabaseSync(DB_PATH);
try {
  db.exec(`VACUUM INTO '${sqlPath}'`);
} finally {
  db.close();
}

// Pangkas: simpan KEEP berkas terbaru (urut waktu modifikasi turun).
const backups = readdirSync(BACKUP_DIR)
  .filter((f) => /^zylora-.*\.db$/.test(f))
  .map((f) => ({ f, m: statSync(join(BACKUP_DIR, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m);

let pruned = 0;
for (const { f } of backups.slice(KEEP)) {
  unlinkSync(join(BACKUP_DIR, f));
  pruned++;
}

console.log(`[zylora-backup] ${outFile} (simpan ${KEEP}, hapus ${pruned} lama)`);
