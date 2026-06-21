// ─────────────────────────────────────────────────────────────────────────────
// Lapisan database Zylora — SQLite embedded bawaan Node (`node:sqlite`).
//
// Dipilih karena: (1) database SQL relasional sungguhan dengan foreign key &
// transaksi, bukan tumpukan state di memori seperti sync-server.mjs; (2) NOL
// dependency eksternal, jadi lolos dari blokir jaringan npm yang didokumentasikan
// di .design-sync/NOTES.md. File DB tersimpan di server/api/data/zylora.db.
// ─────────────────────────────────────────────────────────────────────────────
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ZYLORA_DB || resolve(__dirname, "../data/zylora.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL = baca/tulis lebih lancar saat ada beberapa koneksi; foreign_keys wajib
// di-ON manual di SQLite.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// ─── Skema ──────────────────────────────────────────────────────────────────
// Semua tabel di-scope per `company_id` agar siap multi-perusahaan (lihat
// /api/company/register di spec). Waktu disimpan sebagai TEXT ISO-8601.
db.exec(`
CREATE TABLE IF NOT EXISTS companies (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  address        TEXT,
  contact_email  TEXT,
  industry       TEXT,
  work_start     TEXT NOT NULL DEFAULT '08:00',
  work_end       TEXT NOT NULL DEFAULT '17:00',
  logo_url       TEXT,
  timezone       TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  language        TEXT NOT NULL DEFAULT 'id',
  attendance_mode TEXT NOT NULL DEFAULT 'qr_dynamic',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'control',   -- control (operator sistem kontrol)
  created_at    TEXT NOT NULL
);

-- Token aktif (admin ATAU karyawan); logout = tandai revoked. Blacklist JWT by jti.
CREATE TABLE IF NOT EXISTS sessions (
  jti          TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,        -- control | employee
  subject_id   TEXT NOT NULL,
  company_id   TEXT,
  expires_at   TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT,
  password_hash TEXT,                -- untuk login karyawan (JWT peran 'employee')
  position      TEXT,
  department   TEXT,
  start_date   TEXT,
  status       TEXT NOT NULL DEFAULT 'active',   -- active | inactive
  schedule_in  TEXT DEFAULT '08:00',
  schedule_out TEXT DEFAULT '17:00',
  base_salary  REAL NOT NULL DEFAULT 0,          -- gaji pokok (payroll)
  created_at   TEXT NOT NULL
);

-- Kode/QR personal karyawan (1:1 dengan employee).
CREATE TABLE IF NOT EXISTS employee_codes (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  format      TEXT NOT NULL DEFAULT 'qr',        -- qr | barcode
  code        TEXT NOT NULL,
  secure      INTEGER NOT NULL DEFAULT 1,
  image_url   TEXT,
  updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  address    TEXT,
  type       TEXT NOT NULL DEFAULT 'office',     -- office | warehouse
  lat        REAL,
  lng        REAL,
  radius_m   INTEGER NOT NULL DEFAULT 100,       -- radius validasi LBS (meter)
  created_at TEXT NOT NULL
);

-- QR/barcode milik lokasi: statis (ditempel) atau dinamis (berputar tiap interval).
CREATE TABLE IF NOT EXISTS location_codes (
  id           TEXT PRIMARY KEY,
  location_id  TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,                    -- qr_static | qr_dynamic
  token        TEXT NOT NULL,                    -- nilai terbaru (dinamis dihitung ulang saat dibaca)
  status       TEXT NOT NULL DEFAULT 'active',   -- active | inactive
  interval     TEXT,                             -- hourly | daily (dinamis)
  active_start TEXT,
  active_end   TEXT,
  expires_at   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                     -- YYYY-MM-DD
  check_in    TEXT,
  check_out   TEXT,
  status      TEXT NOT NULL DEFAULT 'hadir',     -- hadir | terlambat | izin | alpa
  method      TEXT,                              -- qr_lokasi | terminal
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  lat         REAL,
  lng         REAL,
  created_at  TEXT NOT NULL,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS shifts (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  start      TEXT NOT NULL,
  end        TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'cuti',      -- cuti | izin | sakit
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  notes       TEXT,
  decided_by  TEXT REFERENCES admins(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  decided_at  TEXT
);

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL,
  label       TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE(company_id, device_id)
);

-- Jejak audit aksi admin (RBAC & kepatuhan).
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  company_id TEXT,
  admin_id   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);

-- ─── PAYROLL ──────────────────────────────────────────────────────────────────
-- Komponen gaji per perusahaan (tunjangan/potongan), tetap atau berbasis absensi.
CREATE TABLE IF NOT EXISTS salary_components (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,                       -- earning | deduction
  basis      TEXT NOT NULL DEFAULT 'fixed',       -- fixed|per_late_min|per_absent_day|per_overtime_hour|percent_base
  value      REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Aturan otomatis berbasis kondisi (Fase 2): mis. telat>=N hari → potongan.
CREATE TABLE IF NOT EXISTS payroll_rules (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  metric     TEXT NOT NULL,                       -- late_days|late_minutes|overtime_hours|absent_days|leave_days
  op         TEXT NOT NULL DEFAULT 'gte',         -- gte|gt
  threshold  REAL NOT NULL DEFAULT 0,
  action     TEXT NOT NULL,                       -- bonus|deduction
  amount     REAL NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Satu kali proses gaji untuk satu periode (YYYY-MM).
CREATE TABLE IF NOT EXISTS payroll_runs (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period     TEXT NOT NULL,                       -- YYYY-MM
  created_by TEXT,
  created_at TEXT NOT NULL
);

-- Slip gaji per karyawan per run (rincian disimpan JSON di kolom detail).
CREATE TABLE IF NOT EXISTS payslips (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,
  base_salary REAL NOT NULL DEFAULT 0,
  earnings    REAL NOT NULL DEFAULT 0,
  deductions  REAL NOT NULL DEFAULT 0,
  net         REAL NOT NULL DEFAULT 0,
  detail      TEXT,
  created_at  TEXT NOT NULL
);
`);

// Migrasi idempoten untuk DB lama (kolom/tabel baru). ALTER melempar bila kolom
// sudah ada → diabaikan.
try { db.exec("ALTER TABLE employees ADD COLUMN base_salary REAL NOT NULL DEFAULT 0"); } catch { /* kolom sudah ada */ }

// ─── Helper kueri ─────────────────────────────────────────────────────────────
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

// Jalankan beberapa operasi dalam satu transaksi (rollback otomatis bila throw).
export function tx(fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
