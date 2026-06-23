// ─────────────────────────────────────────────────────────────────────────────
// Lapisan database Zylora — varian PostgreSQL (Neon). Antarmuka SAMA dengan
// db.mjs (get/all/run/tx) tapi ASINKRON. Dipilih lewat lib/db/index.mjs bila
// ZYLORA_DATABASE_URL di-set; selain itu tetap SQLite (db.mjs).
//
//  • Placeholder gaya SQLite "?" dikonversi otomatis → "$1,$2,..." Postgres.
//  • Transaksi memakai satu koneksi via AsyncLocalStorage, sehingga get/run di
//    dalam tx(fn) otomatis ikut transaksi yang sama (tetap atomik).
//
// Skema dibuat terpisah (deploy/neon-schema.sql via psql) — file ini hanya
// menghubungkan, tidak men-DDL.
// ─────────────────────────────────────────────────────────────────────────────
import { Pool } from "@neondatabase/serverless";
import { AsyncLocalStorage } from "node:async_hooks";

const URL = process.env.ZYLORA_DATABASE_URL || process.env.DATABASE_URL;
if (!URL) {
  console.error("[zylora] FATAL: backend Postgres butuh ZYLORA_DATABASE_URL (atau DATABASE_URL).");
  process.exit(1);
}

export const pool = new Pool({ connectionString: URL });
const txStore = new AsyncLocalStorage(); // menyimpan client transaksi aktif

// Konversi placeholder "?" (gaya SQLite di kode lama) → "$1,$2,..." (Postgres).
function toPg(query) {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

// Eksekusi: pakai client transaksi bila sedang di dalam tx(), kalau tidak pool.
function exec(query, params) {
  const client = txStore.getStore();
  return (client || pool).query(toPg(query), params);
}

export async function get(query, ...params) {
  const r = await exec(query, params);
  return r.rows[0] ?? undefined;
}
export async function all(query, ...params) {
  return (await exec(query, params)).rows;
}
export async function run(query, ...params) {
  const r = await exec(query, params);
  return { changes: r.rowCount ?? 0, lastInsertRowid: undefined };
}

// Transaksi atomik: BEGIN → fn() → COMMIT (ROLLBACK bila throw). get/run di dalam
// fn otomatis memakai koneksi yang sama berkat AsyncLocalStorage.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    return await txStore.run(client, async () => {
      await client.query("BEGIN");
      const out = await fn();
      await client.query("COMMIT");
      return out;
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* abaikan */ }
    throw err;
  } finally {
    client.release();
  }
}

// Paritas API dengan db.mjs (dipakai backup tool, dll). Tidak ada di Postgres
// (backup ditangani Neon), tapi disediakan agar import tidak gagal.
export const db = pool;
