// ─────────────────────────────────────────────────────────────────────────────
// Smoke test integrasi backend Zylora — zero-dependency (node:test + fetch).
// Menjalankan server sungguhan (DB sementara + seed) lalu memverifikasi alur inti:
// health, versi, login control & karyawan, dan RBAC lintas-peran (403).
//
//   node --test server/api/test/        # atau: pnpm test:api
// ─────────────────────────────────────────────────────────────────────────────
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "../server.mjs");
const PORT = Number(process.env.SMOKE_PORT) || 5198;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join(tmpdir(), `zylora-smoke-${process.pid}.db`);

// Kredensial seed (lihat seed.mjs / CLAUDE.md).
const CONTROL = { email: "kontrol@nusantara.co.id", password: "kontrol1234" };
const EMPLOYEE = { employeeId: "EMP001", password: "123456" };

let child;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* belum siap */ }
    if (child.exitCode != null) throw new Error(`server keluar dini (code ${child.exitCode})`);
    await sleep(150);
  }
  throw new Error("server tak kunjung sehat dalam batas waktu");
}

const post = (path, body, token) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
const getJson = (path, token) =>
  fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

before(async () => {
  child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      ZYLORA_HOST: "127.0.0.1",
      ZYLORA_PORT: String(PORT),
      ZYLORA_SECRET: "smoke-test-secret-0123456789abcdef",
      ZYLORA_DB: DB,
      ZYLORA_SEED: "1",
      NODE_ENV: "test",
    },
    stdio: "ignore",
  });
  await waitHealthy();
});

after(async () => {
  child?.kill("SIGTERM");
});

test("GET /health → ok", async () => {
  const r = await fetch(`${BASE}/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.service, "zylora-api");
});

test("GET /api/version → identitas produk", async () => {
  const j = await (await fetch(`${BASE}/api/version`)).json();
  assert.equal(j.product, "Zylora Absensi & HRIS");
  assert.ok(j.version);
});

test("POST /api/control/login → token (kredensial benar)", async () => {
  const r = await post("/api/control/login", CONTROL);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.token, "harus mengembalikan token");
});

test("POST /api/control/login → 401 (password salah)", async () => {
  const r = await post("/api/control/login", { ...CONTROL, password: "salah-sekali" });
  assert.equal(r.status, 401);
});

test("RBAC: token karyawan TIDAK boleh akses endpoint control (403)", async () => {
  const emp = await (await post("/api/employee/login", EMPLOYEE)).json();
  assert.ok(emp.token, "login karyawan harus berhasil");
  const r = await getJson("/api/company", emp.token);
  assert.equal(r.status, 403);
});

test("Control boleh akses /api/company (200)", async () => {
  const ctl = await (await post("/api/control/login", CONTROL)).json();
  const r = await getJson("/api/company", ctl.token);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.companyId);
});

test("GET /api/dashboard → ringkasan agregat (bentuk benar)", async () => {
  const ctl = await (await post("/api/control/login", CONTROL)).json();
  const r = await getJson("/api/dashboard", ctl.token);
  assert.equal(r.status, 200);
  const j = await r.json();
  // KPI hari ini
  assert.ok(j.today && typeof j.today.total === "number", "today.total numerik");
  assert.ok(typeof j.today.attendanceRate === "number");
  // Tren tepat 7 hari
  assert.ok(Array.isArray(j.trend) && j.trend.length === 7, "trend 7 hari");
  // Bagian agregat lain hadir
  assert.ok(typeof j.pendingLeaves === "number");
  assert.ok(Array.isArray(j.headcountByDept));
  assert.ok(Array.isArray(j.recentActivity));
});

test("RBAC: token karyawan TIDAK boleh akses /api/dashboard (403)", async () => {
  const emp = await (await post("/api/employee/login", EMPLOYEE)).json();
  const r = await getJson("/api/dashboard", emp.token);
  assert.equal(r.status, 403);
});
