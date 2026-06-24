// ─────────────────────────────────────────────────────────────────────────────
// Bersih-bersih data DEMO HANYA untuk PT Zylora 1 (TIDAK mengusik tenant lain).
// Zero-dependency, idempoten. Hapus permanen — JALANKAN BACKUP DULU (tools/backup.mjs).
//   1) Mata uang PT Zylora 1 → IDR.
//   2) Hapus karyawan demo (Karyawan Uji, Lucky) + anak-data + payroll-run.
//
//   ZYLORA_DB=/opt/zylora/data/zylora.db node /opt/zylora/api/tools/cleanup-zylora1.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { get, all, run, tx } from "../lib/db.mjs";

const KEEP_CO = "co_97a181b9c7b243929b77";              // PT Zylora 1
const DEMO_EMP = ["emp_d23c356f2d35429a867e", "emp_de332509aa984f7bb4b0"]; // Karyawan Uji, Lucky
const empChildTables = ["attendance", "payslips", "employee_codes", "leave_requests", "devices"];

function del(label, sql, params) {
  try { const r = run(sql, ...params); if (r.changes) console.log(`   - ${label}: ${r.changes} baris`); return r.changes; }
  catch (e) { console.log(`   - ${label}: (lewati: ${e.message})`); return 0; }
}

tx(() => {
  const r = run("UPDATE companies SET base_currency = 'IDR' WHERE id = ?", KEEP_CO);
  console.log(`Mata uang PT Zylora 1 → IDR (${r.changes} baris)`);
  for (const id of DEMO_EMP) {
    const e = get("SELECT name FROM employees WHERE id = ?", id);
    if (!e) { console.log(`(lewati ${id} — sudah tidak ada)`); continue; }
    console.log(`Hapus karyawan demo: ${e.name}`);
    for (const t of empChildTables) del(t, `DELETE FROM ${t} WHERE employee_id = ?`, [id]);
    del("employees", "DELETE FROM employees WHERE id = ?", [id]);
  }
  del("payroll_runs (PT Zylora 1)", "DELETE FROM payroll_runs WHERE company_id = ?", [KEEP_CO]);
});

console.log("\n=== Sisa data PT Zylora 1 ===");
console.log("Company:", JSON.stringify(get("SELECT name,base_currency FROM companies WHERE id = ?", KEEP_CO)));
console.log("Employees:", JSON.stringify(all("SELECT name FROM employees WHERE company_id = ?", KEEP_CO)));
console.log("(Tenant lain TIDAK disentuh.)");
process.exit(0);
