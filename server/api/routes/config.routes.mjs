// ─── 5. Konfigurasi Lain: Shift, Cuti, Perangkat, Log ─────────────────────────
import { json, noContent, ApiError } from "../lib/http.mjs";
import { requireFields, assert } from "../lib/validate.mjs";
import { get, all, run } from "../lib/db.mjs";
import { genId, nowISO } from "../lib/security.mjs";
import { requireControl, audit } from "../lib/middleware.mjs";

export function register(router) {
  // ── Shift ──
  router.get("/api/shifts", requireControl, (ctx) => {
    const rows = all("SELECT * FROM shifts WHERE company_id = ? ORDER BY start", ctx.auth.companyId);
    json(ctx.res, 200, rows.map((s) => ({ shiftId: s.id, name: s.name, start: s.start, end: s.end })));
  });

  router.post("/api/shifts", requireControl, (ctx) => {
    requireFields(ctx.body, ["name", "start", "end"]);
    const id = genId("shift");
    run("INSERT INTO shifts (id, company_id, name, start, end, created_at) VALUES (?,?,?,?,?,?)",
      id, ctx.auth.companyId, ctx.body.name, ctx.body.start, ctx.body.end, nowISO());
    audit(ctx, "shift.create", { id });
    json(ctx.res, 201, { shiftId: id });
  });

  router.put("/api/shifts/:id", requireControl, (ctx) => {
    const s = get("SELECT * FROM shifts WHERE id = ? AND company_id = ?", ctx.params.id, ctx.auth.companyId);
    if (!s) throw new ApiError(404, "Shift tidak ditemukan", "NOT_FOUND");
    const sets = [];
    const vals = [];
    for (const k of ["name", "start", "end"]) {
      if (ctx.body[k] !== undefined) { sets.push(`${k} = ?`); vals.push(ctx.body[k]); }
    }
    assert(sets.length > 0, 400, "Tidak ada field yang diperbarui");
    run(`UPDATE shifts SET ${sets.join(", ")} WHERE id = ?`, ...vals, ctx.params.id);
    audit(ctx, "shift.update", { id: ctx.params.id });
    json(ctx.res, 200, { message: "Shift updated" });
  });

  // ── Cuti / Izin ──
  router.get("/api/leaves/requests", requireControl, (ctx) => {
    const where = ["lr.company_id = ?"];
    const vals = [ctx.auth.companyId];
    if (ctx.query.status) { where.push("lr.status = ?"); vals.push(ctx.query.status); }
    const rows = all(
      `SELECT lr.*, e.name AS employee_name FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       WHERE ${where.join(" AND ")} ORDER BY lr.created_at DESC`, ...vals,
    );
    json(ctx.res, 200, rows.map((r) => ({
      requestId: r.id, employeeId: r.employee_id, employee_name: r.employee_name,
      type: r.type, start_date: r.start_date, end_date: r.end_date,
      reason: r.reason, status: r.status, notes: r.notes,
    })));
  });

  // Buat pengajuan cuti (dipakai app karyawan; di sini diterima dengan auth admin
  // atau bisa dipindah ke endpoint karyawan). Disertakan agar approve punya data.
  router.post("/api/leaves/requests", requireControl, (ctx) => {
    const b = ctx.body;
    requireFields(b, ["employeeId", "start_date", "end_date"]);
    const emp = get("SELECT id FROM employees WHERE id = ? AND company_id = ?", b.employeeId, ctx.auth.companyId);
    if (!emp) throw new ApiError(404, "Karyawan tidak ditemukan", "NOT_FOUND");
    const id = genId("leave");
    run(
      `INSERT INTO leave_requests (id, company_id, employee_id, type, start_date, end_date, reason, status, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, ctx.auth.companyId, b.employeeId, b.type || "cuti", b.start_date, b.end_date,
      b.reason || null, "pending", nowISO(),
    );
    json(ctx.res, 201, { requestId: id });
  });

  // Setujui / tolak pengajuan.
  router.post("/api/leaves/:requestId/approve", requireControl, (ctx) => {
    const lr = get("SELECT * FROM leave_requests WHERE id = ? AND company_id = ?",
      ctx.params.requestId, ctx.auth.companyId);
    if (!lr) throw new ApiError(404, "Pengajuan tidak ditemukan", "NOT_FOUND");
    const approved = ctx.body.approved !== false;
    const status = approved ? "approved" : "rejected";
    run("UPDATE leave_requests SET status = ?, notes = ?, decided_by = ?, decided_at = ? WHERE id = ?",
      status, ctx.body.notes || null, ctx.auth.operatorId, nowISO(), ctx.params.requestId);
    audit(ctx, "leave.decide", { requestId: ctx.params.requestId, status });
    json(ctx.res, 200, { requestId: ctx.params.requestId, status });
  });

  // ── Perangkat terdaftar (pembatasan multi-device) ──
  router.get("/api/devices", requireControl, (ctx) => {
    const rows = all("SELECT * FROM devices WHERE company_id = ? ORDER BY created_at DESC", ctx.auth.companyId);
    json(ctx.res, 200, rows.map((d) => ({
      id: d.id, employeeId: d.employee_id, deviceId: d.device_id, label: d.label, created_at: d.created_at,
    })));
  });

  router.post("/api/devices", requireControl, (ctx) => {
    const b = ctx.body;
    requireFields(b, ["employeeId", "deviceId"]);
    const emp = get("SELECT id FROM employees WHERE id = ? AND company_id = ?", b.employeeId, ctx.auth.companyId);
    if (!emp) throw new ApiError(404, "Karyawan tidak ditemukan", "NOT_FOUND");
    if (get("SELECT 1 FROM devices WHERE company_id = ? AND device_id = ?", ctx.auth.companyId, b.deviceId)) {
      throw new ApiError(409, "Perangkat sudah terdaftar", "DEVICE_EXISTS");
    }
    const id = genId("dev");
    run("INSERT INTO devices (id, company_id, employee_id, device_id, label, created_at) VALUES (?,?,?,?,?,?)",
      id, ctx.auth.companyId, b.employeeId, b.deviceId, b.label || null, nowISO());
    audit(ctx, "device.register", { id });
    json(ctx.res, 201, { id });
  });

  // ── Log aktivitas admin ──
  router.get("/api/logs", requireControl, (ctx) => {
    const where = ["company_id = ?"];
    const vals = [ctx.auth.companyId];
    if (ctx.query.from) { where.push("created_at >= ?"); vals.push(ctx.query.from); }
    if (ctx.query.to) { where.push("created_at <= ?"); vals.push(ctx.query.to); }
    const rows = all(
      `SELECT * FROM audit_logs WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 500`, ...vals);
    json(ctx.res, 200, rows.map((l) => ({
      id: l.id, admin_id: l.admin_id, action: l.action, detail: l.detail, ip: l.ip, created_at: l.created_at,
    })));
  });
}
