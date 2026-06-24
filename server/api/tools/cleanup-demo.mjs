// ─────────────────────────────────────────────────────────────────────────────
// Bersih-bersih data DEMO di produksi (sekali pakai, idempoten). Zero-dependency.
//   1) Set mata uang perusahaan utama → IDR.
//   2) Hapus karyawan demo + seluruh anak-datanya (absensi, slip, kode, izin, perangkat).
//   3) Hapus tenant sampah (perusahaan + admin + sesi-nya).
// JALANKAN BACKUP DULU (tools/backup.mjs). Hapus permanen.
//
//   ZYLORA_DB=/opt/zylora/data/zylora.db node /opt/zylora/api/tools/cleanup-demo.mjs
// ─────────────────────────────────────────────────────────────────────────────
import { db, get, all, run, tx } from "../lib/db.mjs";

const KEEP_CO = "co_97a181b9c7b243929b77";              // PT Zylora 1 (dipertahankan)
const DEMO_EMP = ["emp_d23c356f2d35429a867e", "emp_de332509aa984f7bb4b0"]; // Karyawan Uji, Lucky
const JUNK_CO = ["co_099c5507a5df453dab61", "co_29b57c294b7146ef9270"];    // Mari Yuk Makan, "11"

// DELETE aman: lewati tabel/kolom yang tak ada (try/catch), cetak jumlah baris.
function del(label, sql, params) {
  try { const r = run(sql, ...params); if (r.changes) console.log(`   - ${label}: ${r.changes} baris`); return r.changes; }
  catch (e) { console.log(`   - ${label}: (lewati: ${e.message})`); return 0; }
}
const empChildTables = ["attendance", "payslips", "employee_codes", "leave_requests", "devices"];
const coTables = ["sessions", "admins", "audit_logs", "attendance", "payslips", "payroll_runs",
  "salary_components", "payroll_rules", "exchange_rates", "leave_requests", "devices", "shifts",
  "employee_codes", "location_codes", "locations", "employees"];

tx(() => {
  // 1) Mata uang → IDR
  const r = run("UPDATE companies SET base_currency = 'IDR' WHERE id = ?", KEEP_CO);
  console.log(`Mata uang ${KEEP_CO} → IDR (${r.changes} baris)`);

  // 2) Karyawan demo + anak-data
  for (const id of DEMO_EMP) {
    const e = get("SELECT name FROM employees WHERE id = ?", id);
    console.log(`Hapus karyawan demo: ${e?.name || id}`);
    for (const t of empChildTables) del(t, `DELETE FROM ${t} WHERE employee_id = ?`, [id]);
    del("employees", "DELETE FROM employees WHERE id = ?", [id]);
  }
  // Run payroll yatim di KEEP_CO (slip sudah terhapus via employee) → bersihkan.
  del("payroll_runs (KEEP_CO)", "DELETE FROM payroll_runs WHERE company_id = ?", [KEEP_CO]);

  // 3) Tenant sampah: hapus semua data company_id-nya lalu company row.
  for (const co of JUNK_CO) {
    const c = get("SELECT name FROM companies WHERE id = ?", co);
    console.log(`Hapus tenant sampah: ${c?.name || co}`);
    // anak via employee/lokasi dulu
    const empIds = all("SELECT id FROM employees WHERE company_id = ?", co).map(x => x.id);
    for (const eid of empIds) for (const t of empChildTables) del(`${t}(emp)`, `DELETE FROM ${t} WHERE employee_id = ?`, [eid]);
    const locIds = all("SELECT id FROM locations WHERE company_id = ?", co).map(x => x.id);
    for (const lid of locIds) del("location_codes(loc)", "DELETE FROM location_codes WHERE location_id = ?", [lid]);
    for (const t of coTables) del(t, `DELETE FROM ${t} WHERE company_id = ?`, [co]);
    del("companies", "DELETE FROM companies WHERE id = ?", [co]);
  }
});

console.log("\n=== Sisa data ===");
console.log("Companies:", JSON.stringify(all("SELECT id,name,base_currency FROM companies")));
console.log("Employees:", JSON.stringify(all("SELECT name,company_id FROM employees")));
console.log("Admins:", JSON.stringify(all("SELECT email,company_id FROM admins")));
process.exit(0);
