// ─── 6. Payroll: komponen gaji, aturan otomatis, proses & slip gaji ───────────
import { json, noContent, ApiError } from "../lib/http.mjs";
import { requireFields, assert } from "../lib/validate.mjs";
import { get, all, run, tx } from "../lib/db.mjs";
import { genId, nowISO } from "../lib/security.mjs";
import { requireControl, audit } from "../lib/middleware.mjs";
import { computePayslip } from "../lib/payroll-core.mjs";

const BASES = ["fixed", "percent_base", "per_late_min", "per_absent_day", "per_overtime_hour"];
const METRICS = ["late_days", "late_minutes", "overtime_hours", "absent_days", "leave_days"];

export function register(router) {
  // ── Komponen gaji (tunjangan/potongan) ──
  router.get("/api/salary-components", requireControl, (ctx) => {
    json(ctx.res, 200, all("SELECT * FROM salary_components WHERE company_id = ? ORDER BY type, name", ctx.auth.companyId)
      .map((c) => ({ id: c.id, name: c.name, type: c.type, basis: c.basis, value: c.value })));
  });
  router.post("/api/salary-components", requireControl, (ctx) => {
    const b = ctx.body;
    requireFields(b, ["name", "type"]);
    assert(["earning", "deduction"].includes(b.type), 400, "type: earning|deduction");
    assert(BASES.includes(b.basis || "fixed"), 400, `basis: ${BASES.join("|")}`);
    const id = genId("sc");
    run("INSERT INTO salary_components (id, company_id, name, type, basis, value, created_at) VALUES (?,?,?,?,?,?,?)",
      id, ctx.auth.companyId, b.name, b.type, b.basis || "fixed", Number(b.value) || 0, nowISO());
    audit(ctx, "salary_component.create", { id });
    json(ctx.res, 201, { id });
  });
  router.put("/api/salary-components/:id", requireControl, (ctx) => {
    if (!get("SELECT 1 FROM salary_components WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId))
      throw new ApiError(404, "Component not found", "NOT_FOUND");
    const b = ctx.body;
    const sets = [];
    const vals = [];
    if (b.name !== undefined) { sets.push("name = ?"); vals.push(b.name); }
    if (b.type !== undefined) { assert(["earning", "deduction"].includes(b.type), 400, "type: earning|deduction"); sets.push("type = ?"); vals.push(b.type); }
    if (b.basis !== undefined) { assert(BASES.includes(b.basis), 400, `basis: ${BASES.join("|")}`); sets.push("basis = ?"); vals.push(b.basis); }
    if (b.value !== undefined) { sets.push("value = ?"); vals.push(Number(b.value) || 0); }
    assert(sets.length > 0, 400, "No fields to update");
    run(`UPDATE salary_components SET ${sets.join(", ")} WHERE id = ?`, ...vals, ctx.params.id);
    audit(ctx, "salary_component.update", { id: ctx.params.id });
    json(ctx.res, 200, { message: "Component updated" });
  });
  router.delete("/api/salary-components/:id", requireControl, (ctx) => {
    if (!get("SELECT 1 FROM salary_components WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId))
      throw new ApiError(404, "Component not found", "NOT_FOUND");
    run("DELETE FROM salary_components WHERE id = ?", ctx.params.id);
    audit(ctx, "salary_component.delete", { id: ctx.params.id });
    noContent(ctx.res);
  });

  // ── Aturan otomatis (Fase 2) ──
  router.get("/api/payroll-rules", requireControl, (ctx) => {
    json(ctx.res, 200, all("SELECT * FROM payroll_rules WHERE company_id = ? ORDER BY name", ctx.auth.companyId)
      .map((r) => ({ id: r.id, name: r.name, metric: r.metric, op: r.op, threshold: r.threshold, action: r.action, amount: r.amount, active: !!r.active })));
  });
  router.post("/api/payroll-rules", requireControl, (ctx) => {
    const b = ctx.body;
    requireFields(b, ["name", "metric", "action"]);
    assert(METRICS.includes(b.metric), 400, `metric: ${METRICS.join("|")}`);
    assert(["bonus", "deduction"].includes(b.action), 400, "action: bonus|deduction");
    const id = genId("rule");
    run("INSERT INTO payroll_rules (id, company_id, name, metric, op, threshold, action, amount, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      id, ctx.auth.companyId, b.name, b.metric, b.op === "gt" ? "gt" : "gte", Number(b.threshold) || 0, b.action, Number(b.amount) || 0, b.active === false ? 0 : 1, nowISO());
    audit(ctx, "payroll_rule.create", { id });
    json(ctx.res, 201, { id });
  });
  router.put("/api/payroll-rules/:id", requireControl, (ctx) => {
    if (!get("SELECT 1 FROM payroll_rules WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId))
      throw new ApiError(404, "Rule not found", "NOT_FOUND");
    const b = ctx.body;
    const sets = [];
    const vals = [];
    if (b.name !== undefined) { sets.push("name = ?"); vals.push(b.name); }
    if (b.metric !== undefined) { assert(METRICS.includes(b.metric), 400, `metric: ${METRICS.join("|")}`); sets.push("metric = ?"); vals.push(b.metric); }
    if (b.op !== undefined) { sets.push("op = ?"); vals.push(b.op === "gt" ? "gt" : "gte"); }
    if (b.threshold !== undefined) { sets.push("threshold = ?"); vals.push(Number(b.threshold) || 0); }
    if (b.action !== undefined) { assert(["bonus", "deduction"].includes(b.action), 400, "action: bonus|deduction"); sets.push("action = ?"); vals.push(b.action); }
    if (b.amount !== undefined) { sets.push("amount = ?"); vals.push(Number(b.amount) || 0); }
    if (b.active !== undefined) { sets.push("active = ?"); vals.push(b.active ? 1 : 0); }
    assert(sets.length > 0, 400, "No fields to update");
    run(`UPDATE payroll_rules SET ${sets.join(", ")} WHERE id = ?`, ...vals, ctx.params.id);
    audit(ctx, "payroll_rule.update", { id: ctx.params.id });
    json(ctx.res, 200, { message: "Rule updated" });
  });
  router.delete("/api/payroll-rules/:id", requireControl, (ctx) => {
    if (!get("SELECT 1 FROM payroll_rules WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId))
      throw new ApiError(404, "Rule not found", "NOT_FOUND");
    run("DELETE FROM payroll_rules WHERE id = ?", ctx.params.id);
    audit(ctx, "payroll_rule.delete", { id: ctx.params.id });
    noContent(ctx.res);
  });

  // ── Jalankan payroll untuk satu periode (YYYY-MM) ──
  router.post("/api/payroll/run", requireControl, (ctx) => {
    const period = ctx.body.period;
    assert(/^\d{4}-\d{2}$/.test(period || ""), 400, "period must be in YYYY-MM format");
    const comps = all("SELECT * FROM salary_components WHERE company_id = ?", ctx.auth.companyId);
    const rules = all("SELECT * FROM payroll_rules WHERE company_id = ? AND active = 1", ctx.auth.companyId);
    const emps = all("SELECT * FROM employees WHERE company_id = ? AND status = 'active'", ctx.auth.companyId);
    const baseCur = get("SELECT base_currency FROM companies WHERE id = ?", ctx.auth.companyId)?.base_currency || "IDR";
    const runId = genId("run");
    const ts = nowISO();
    const slips = [];
    tx(() => {
      // Idempoten per periode: hapus run + slip lama periode ini agar re-run
      // MEREFRESH (bukan menduplikat). Tanpa ini, slip basi tak ikut perubahan
      // aturan/absensi → terlambat ada tapi potongan di slip lama tetap 0.
      run("DELETE FROM payslips WHERE company_id = ? AND period = ?", ctx.auth.companyId, period);
      run("DELETE FROM payroll_runs WHERE company_id = ? AND period = ?", ctx.auth.companyId, period);
      run("INSERT INTO payroll_runs (id, company_id, period, created_by, created_at) VALUES (?,?,?,?,?)",
        runId, ctx.auth.companyId, period, ctx.auth.operatorId || null, ts);
      for (const e of emps) {
        const ps = computePayslip(e, period, comps, rules);
        // Slip dihitung & disimpan dalam mata uang operasional perusahaan (baseCur).
        run("INSERT INTO payslips (id, run_id, company_id, employee_id, period, base_salary, earnings, deductions, net, detail, currency, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          genId("slip"), runId, ctx.auth.companyId, e.id, period, ps.base_salary, ps.earnings, ps.deductions, ps.net,
          JSON.stringify({ metrics: ps.metrics, lines: ps.lines }), baseCur, ts);
        slips.push({ employeeId: e.id, name: e.name, net: ps.net });
      }
    });
    audit(ctx, "payroll.run", { runId, period, count: slips.length });
    json(ctx.res, 201, { runId, period, count: slips.length, totalNet: slips.reduce((a, s) => a + s.net, 0) });
  });

  // Daftar proses payroll.
  router.get("/api/payroll/runs", requireControl, (ctx) => {
    const runs = all("SELECT * FROM payroll_runs WHERE company_id = ? ORDER BY period DESC, created_at DESC", ctx.auth.companyId);
    json(ctx.res, 200, runs.map((r) => {
      const agg = get("SELECT COUNT(*) AS n, COALESCE(SUM(net),0) AS total FROM payslips WHERE run_id = ?", r.id);
      return { runId: r.id, period: r.period, created_at: r.created_at, count: agg.n, totalNet: agg.total };
    }));
  });

  // Hapus satu proses payroll (slip gaji ikut terhapus via FK CASCADE).
  router.delete("/api/payroll/runs/:id", requireControl, (ctx) => {
    if (!get("SELECT 1 FROM payroll_runs WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId))
      throw new ApiError(404, "Run not found", "NOT_FOUND");
    run("DELETE FROM payroll_runs WHERE id = ?", ctx.params.id);
    audit(ctx, "payroll.run.delete", { id: ctx.params.id });
    noContent(ctx.res);
  });

  // ── Kurs / multi-currency ──
  router.get("/api/exchange-rates", requireControl, (ctx) => {
    const base = get("SELECT base_currency FROM companies WHERE id = ?", ctx.auth.companyId)?.base_currency || "IDR";
    json(ctx.res, 200, all("SELECT * FROM exchange_rates WHERE company_id = ? ORDER BY date DESC, created_at DESC", ctx.auth.companyId)
      .map((r) => ({ id: r.id, currency: r.currency, rate: r.rate, base, date: r.date })));
  });
  router.post("/api/exchange-rates", requireControl, (ctx) => {
    const b = ctx.body;
    requireFields(b, ["currency", "rate"]);
    const cur = String(b.currency).toUpperCase().trim();
    assert(/^[A-Z]{3}$/.test(cur), 400, "currency must be a 3-letter ISO 4217 code (USD, EUR, SGD, ...)");
    assert(Number(b.rate) > 0, 400, "rate must be > 0");
    const id = genId("fx");
    run("INSERT INTO exchange_rates (id, company_id, currency, rate, date, created_at) VALUES (?,?,?,?,?,?)",
      id, ctx.auth.companyId, cur, Number(b.rate),
      /^\d{4}-\d{2}-\d{2}$/.test(b.date || "") ? b.date : nowISO().slice(0, 10), nowISO());
    audit(ctx, "fx.create", { id });
    json(ctx.res, 201, { id });
  });
  router.put("/api/exchange-rates/:id", requireControl, (ctx) => {
    if (!get("SELECT 1 FROM exchange_rates WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId))
      throw new ApiError(404, "Rate not found", "NOT_FOUND");
    const b = ctx.body;
    const sets = [];
    const vals = [];
    if (b.currency !== undefined) {
      const cur = String(b.currency).toUpperCase().trim();
      assert(/^[A-Z]{3}$/.test(cur), 400, "currency must be a 3-letter ISO 4217 code");
      sets.push("currency = ?"); vals.push(cur);
    }
    if (b.rate !== undefined) { assert(Number(b.rate) > 0, 400, "rate must be > 0"); sets.push("rate = ?"); vals.push(Number(b.rate)); }
    if (b.date !== undefined) { assert(/^\d{4}-\d{2}-\d{2}$/.test(b.date), 400, "date format YYYY-MM-DD"); sets.push("date = ?"); vals.push(b.date); }
    assert(sets.length > 0, 400, "No fields to update");
    run(`UPDATE exchange_rates SET ${sets.join(", ")} WHERE id = ?`, ...vals, ctx.params.id);
    audit(ctx, "fx.update", { id: ctx.params.id });
    json(ctx.res, 200, { message: "Rate updated" });
  });
  router.delete("/api/exchange-rates/:id", requireControl, (ctx) => {
    if (!get("SELECT 1 FROM exchange_rates WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId))
      throw new ApiError(404, "Rate not found", "NOT_FOUND");
    run("DELETE FROM exchange_rates WHERE id = ?", ctx.params.id);
    audit(ctx, "fx.delete", { id: ctx.params.id });
    noContent(ctx.res);
  });

  // Slip gaji untuk satu run.
  router.get("/api/payroll/runs/:id/payslips", requireControl, (ctx) => {
    if (!get("SELECT 1 FROM payroll_runs WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId))
      throw new ApiError(404, "Run not found", "NOT_FOUND");
    const rows = all(
      `SELECT p.*, e.name AS employee_name FROM payslips p JOIN employees e ON e.id = p.employee_id
       WHERE p.run_id = ? ORDER BY e.name`, ctx.params.id);
    json(ctx.res, 200, rows.map((p) => ({
      id: p.id, employeeId: p.employee_id, name: p.employee_name, period: p.period,
      base_salary: p.base_salary, earnings: p.earnings, deductions: p.deductions, net: p.net,
      currency: p.currency || "IDR",
      detail: p.detail ? JSON.parse(p.detail) : null,
    })));
  });
}
