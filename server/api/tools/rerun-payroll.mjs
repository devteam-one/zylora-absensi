// ─────────────────────────────────────────────────────────────────────────────
// Hitung-ulang payroll satu/seluruh perusahaan untuk satu periode (YYYY-MM).
// Zero-dependency (node:sqlite). Idempoten: hapus run+slip lama periode itu lalu
// hitung ulang dari absensi + komponen + aturan TERKINI → slip basi (potongan
// telat 0) ter-refresh jadi benar. Logika identik endpoint POST /api/payroll/run.
//
// Pakai (di server, DB produksi):
//   ZYLORA_DB=/opt/zylora/data/zylora.db \
//   node /opt/zylora/api/tools/rerun-payroll.mjs --period 2026-06 [--company co_xxx]
//   (tanpa --company → semua perusahaan; tanpa --period → bulan berjalan)
// ─────────────────────────────────────────────────────────────────────────────
import { all, get, run, tx } from "../lib/db.mjs";
import { computePayslip } from "../lib/payroll-core.mjs";
import { genId, nowISO } from "../lib/security.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const now = new Date();
const period = arg("period") || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
if (!/^\d{4}-\d{2}$/.test(period)) { console.error("✗ --period harus format YYYY-MM"); process.exit(1); }
const onlyCompany = arg("company");

const companies = onlyCompany
  ? all("SELECT id, name, base_currency FROM companies WHERE id = ?", onlyCompany)
  : all("SELECT id, name, base_currency FROM companies");
if (!companies.length) { console.error("✗ Perusahaan tidak ditemukan"); process.exit(1); }

let totalSlips = 0;
for (const co of companies) {
  const comps = all("SELECT * FROM salary_components WHERE company_id = ?", co.id);
  const rules = all("SELECT * FROM payroll_rules WHERE company_id = ? AND active = 1", co.id);
  const emps = all("SELECT * FROM employees WHERE company_id = ? AND status = 'active'", co.id);
  const baseCur = co.base_currency || "IDR";
  const runId = genId("run");
  const ts = nowISO();
  const out = [];
  tx(() => {
    run("DELETE FROM payslips WHERE company_id = ? AND period = ?", co.id, period);
    run("DELETE FROM payroll_runs WHERE company_id = ? AND period = ?", co.id, period);
    run("INSERT INTO payroll_runs (id, company_id, period, created_by, created_at) VALUES (?,?,?,?,?)",
      runId, co.id, period, null, ts);
    for (const e of emps) {
      const ps = computePayslip(e, period, comps, rules);
      run("INSERT INTO payslips (id, run_id, company_id, employee_id, period, base_salary, earnings, deductions, net, detail, currency, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        genId("slip"), runId, co.id, e.id, period, ps.base_salary, ps.earnings, ps.deductions, ps.net,
        JSON.stringify({ metrics: ps.metrics, lines: ps.lines }), baseCur, ts);
      out.push({ name: e.name, deductions: ps.deductions, net: ps.net });
    }
  });
  totalSlips += out.length;
  console.log(`✓ ${co.name} [${period}] → ${out.length} slip:`);
  for (const o of out) console.log(`   - ${o.name}: potongan ${o.deductions}, net ${o.net}`);
}
console.log(`Selesai: ${totalSlips} slip dihitung ulang untuk periode ${period}.`);
process.exit(0);
