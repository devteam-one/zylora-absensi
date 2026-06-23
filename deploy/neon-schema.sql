-- Skema Zylora untuk PostgreSQL (Neon) — terjemahan dari server/api/lib/db.mjs.
-- Perbedaan dari SQLite: REAL → double precision; kolom reserved "end"/"interval"
-- di-quote; sisanya kompatibel. Boolean tetap INTEGER (0/1) agar cocok dgn kode JS.
BEGIN;

CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  address         TEXT,
  contact_email   TEXT,
  industry        TEXT,
  work_start      TEXT NOT NULL DEFAULT '08:00',
  work_end        TEXT NOT NULL DEFAULT '17:00',
  logo_url        TEXT,
  timezone        TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  language        TEXT NOT NULL DEFAULT 'id',
  attendance_mode TEXT NOT NULL DEFAULT 'qr_dynamic',
  base_currency   TEXT NOT NULL DEFAULT 'IDR',
  created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'control',
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  jti          TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
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
  password_hash TEXT,
  position      TEXT,
  department    TEXT,
  start_date    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  schedule_in   TEXT DEFAULT '08:00',
  schedule_out  TEXT DEFAULT '17:00',
  base_salary   DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_codes (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  format      TEXT NOT NULL DEFAULT 'qr',
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
  type       TEXT NOT NULL DEFAULT 'office',
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  radius_m   INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS location_codes (
  id           TEXT PRIMARY KEY,
  location_id  TEXT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  token        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  "interval"   TEXT,
  serial       INTEGER NOT NULL DEFAULT 0,
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
  date        TEXT NOT NULL,
  check_in    TEXT,
  check_out   TEXT,
  status      TEXT NOT NULL DEFAULT 'hadir',
  method      TEXT,
  location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  created_at  TEXT NOT NULL,
  UNIQUE(employee_id, date)
);

CREATE TABLE IF NOT EXISTS shifts (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  start      TEXT NOT NULL,
  "end"      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'cuti',
  start_date  TEXT NOT NULL,
  end_date    TEXT NOT NULL,
  reason      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
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

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  company_id TEXT,
  admin_id   TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS salary_components (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  basis      TEXT NOT NULL DEFAULT 'fixed',
  value      DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_rules (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  metric     TEXT NOT NULL,
  op         TEXT NOT NULL DEFAULT 'gte',
  threshold  DOUBLE PRECISION NOT NULL DEFAULT 0,
  action     TEXT NOT NULL,
  amount     DOUBLE PRECISION NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period     TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  currency   TEXT NOT NULL,
  rate       DOUBLE PRECISION NOT NULL,
  date       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payslips (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period      TEXT NOT NULL,
  base_salary DOUBLE PRECISION NOT NULL DEFAULT 0,
  earnings    DOUBLE PRECISION NOT NULL DEFAULT 0,
  deductions  DOUBLE PRECISION NOT NULL DEFAULT 0,
  net         DOUBLE PRECISION NOT NULL DEFAULT 0,
  detail      TEXT,
  currency    TEXT,
  created_at  TEXT NOT NULL
);

COMMIT;
