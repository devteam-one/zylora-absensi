// ─── 3 & 4.2. Manajemen Karyawan + Kode Personal ─────────────────────────────
import { json, noContent, ApiError } from "../lib/http.mjs";
import { requireFields, pick, assert } from "../lib/validate.mjs";
import { get, all, run } from "../lib/db.mjs";
import { genId, nowISO } from "../lib/security.mjs";
import { employeeCode, qrImageUrl } from "../lib/qr.mjs";
import { requireControl, audit } from "../lib/middleware.mjs";

// Ambil karyawan dan pastikan ia milik perusahaan si admin (cegah akses lintas-perusahaan).
function ownedEmployee(ctx, id) {
  const emp = get("SELECT * FROM employees WHERE id = ? AND company_id = ?", id, ctx.auth.companyId);
  if (!emp) throw new ApiError(404, "Karyawan tidak ditemukan", "NOT_FOUND");
  return emp;
}

function serialize(emp) {
  const code = get("SELECT code FROM employee_codes WHERE employee_id = ?", emp.id);
  return {
    employeeId: emp.id,
    name: emp.name,
    email: emp.email,
    position: emp.position,
    department: emp.department,
    start_date: emp.start_date,
    status: emp.status,
    schedule: { in: emp.schedule_in, out: emp.schedule_out },
    barcode: code?.code || null,
  };
}

export function register(router) {
  // Tambah karyawan.
  router.post("/api/employees", requireControl, (ctx) => {
    const b = ctx.body;
    requireFields(b, ["name"]);
    const id = genId("emp");
    run(
      `INSERT INTO employees (id, company_id, name, email, position, department, start_date, status, schedule_in, schedule_out, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, ctx.auth.companyId, b.name, b.email || null, b.position || null, b.department || null,
      b.start_date || null, "active", b.schedule_in || "08:00", b.schedule_out || "17:00", nowISO(),
    );
    audit(ctx, "employee.create", { id });
    json(ctx.res, 201, { employeeId: id });
  });

  // Daftar karyawan (filter ?name= &position= &status=).
  router.get("/api/employees", requireControl, (ctx) => {
    const where = ["company_id = ?"];
    const vals = [ctx.auth.companyId];
    if (ctx.query.name) { where.push("name LIKE ?"); vals.push(`%${ctx.query.name}%`); }
    if (ctx.query.position) { where.push("position LIKE ?"); vals.push(`%${ctx.query.position}%`); }
    if (ctx.query.status) { where.push("status = ?"); vals.push(ctx.query.status); }
    const rows = all(`SELECT * FROM employees WHERE ${where.join(" AND ")} ORDER BY name`, ...vals);
    json(ctx.res, 200, rows.map(serialize));
  });

  // Detail satu karyawan.
  router.get("/api/employees/:id", requireControl, (ctx) => {
    json(ctx.res, 200, serialize(ownedEmployee(ctx, ctx.params.id)));
  });

  // Update.
  router.put("/api/employees/:id", requireControl, (ctx) => {
    ownedEmployee(ctx, ctx.params.id);
    const fields = pick(ctx.body, [
      "name", "email", "position", "department", "start_date", "status", "schedule_in", "schedule_out",
    ]);
    const keys = Object.keys(fields);
    assert(keys.length > 0, 400, "Tidak ada field yang diperbarui");
    run(
      `UPDATE employees SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ? AND company_id = ?`,
      ...keys.map((k) => fields[k]), ctx.params.id, ctx.auth.companyId,
    );
    audit(ctx, "employee.update", { id: ctx.params.id, fields: keys });
    json(ctx.res, 200, serialize(ownedEmployee(ctx, ctx.params.id)));
  });

  // Hapus / nonaktifkan. ?soft=true → set status inactive (default hard delete).
  router.delete("/api/employees/:id", requireControl, (ctx) => {
    ownedEmployee(ctx, ctx.params.id);
    if (ctx.query.soft === "true") {
      run("UPDATE employees SET status = 'inactive' WHERE id = ?", ctx.params.id);
      audit(ctx, "employee.deactivate", { id: ctx.params.id });
    } else {
      run("DELETE FROM employees WHERE id = ?", ctx.params.id);
      audit(ctx, "employee.delete", { id: ctx.params.id });
    }
    noContent(ctx.res);
  });

  // Riwayat presensi (?start=YYYY-MM-DD&end=YYYY-MM-DD).
  router.get("/api/employees/:id/attendance", requireControl, (ctx) => {
    ownedEmployee(ctx, ctx.params.id);
    const where = ["employee_id = ?"];
    const vals = [ctx.params.id];
    if (ctx.query.start) { where.push("date >= ?"); vals.push(ctx.query.start); }
    if (ctx.query.end) { where.push("date <= ?"); vals.push(ctx.query.end); }
    const rows = all(
      `SELECT date, check_in, check_out, status, method, location_id FROM attendance
       WHERE ${where.join(" AND ")} ORDER BY date DESC`, ...vals,
    );
    json(ctx.res, 200, rows.map((r) => ({
      date: r.date, check_in: r.check_in, check_out: r.check_out,
      status: r.status, method: r.method, location: r.location_id,
    })));
  });

  // Buat/perbarui kode personal (QR/barcode) karyawan.
  router.post("/api/employees/:id/code", requireControl, (ctx) => {
    ownedEmployee(ctx, ctx.params.id);
    const format = ctx.body.format === "barcode" ? "barcode" : "qr";
    const secure = ctx.body.secure !== false ? 1 : 0;
    const code = employeeCode(ctx.params.id, format);
    const image = qrImageUrl(code);
    run(
      `INSERT INTO employee_codes (employee_id, format, code, secure, image_url, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(employee_id) DO UPDATE SET format=excluded.format, code=excluded.code,
         secure=excluded.secure, image_url=excluded.image_url, updated_at=excluded.updated_at`,
      ctx.params.id, format, code, secure, image, nowISO(),
    );
    audit(ctx, "employee.code.set", { id: ctx.params.id });
    json(ctx.res, 201, { code, imageUrl: image, format });
  });

  // Ambil kode personal.
  router.get("/api/employees/:id/code", requireControl, (ctx) => {
    ownedEmployee(ctx, ctx.params.id);
    const c = get("SELECT * FROM employee_codes WHERE employee_id = ?", ctx.params.id);
    if (!c) throw new ApiError(404, "Kode personal belum dibuat", "NO_CODE");
    json(ctx.res, 200, { code: c.code, imageUrl: c.image_url, format: c.format });
  });

  // Reset / hapus kode personal.
  router.post("/api/employees/:id/code/reset", requireControl, (ctx) => {
    ownedEmployee(ctx, ctx.params.id);
    run("DELETE FROM employee_codes WHERE employee_id = ?", ctx.params.id);
    audit(ctx, "employee.code.reset", { id: ctx.params.id });
    noContent(ctx.res);
  });
}
