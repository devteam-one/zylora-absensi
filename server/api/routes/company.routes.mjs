// ─── 2. Manajemen Profil Perusahaan ──────────────────────────────────────────
// /api/company (GET/PUT), /api/company/logo (POST), /api/company/settings (GET/PUT)
import { json, ApiError } from "../lib/http.mjs";
import { pick, assert } from "../lib/validate.mjs";
import { get, run } from "../lib/db.mjs";
import { nowISO } from "../lib/security.mjs";
import { requireControl, audit } from "../lib/middleware.mjs";
import { safeTz } from "../lib/attendance-core.mjs";

const ATTENDANCE_MODES = ["qr_static", "qr_dynamic", "terminal_scan"];
// Logo diterima sebagai URL atau data URL base64 di body JSON (tanpa storage).
// Batasi agar tidak menggemukkan baris DB; body HTTP sendiri dibatasi 5MB.
const MAX_LOGO_LEN = 2_000_000;

function currentCompany(ctx) {
  const c = get("SELECT * FROM companies WHERE id = ?", ctx.auth.companyId);
  if (!c) throw new ApiError(404, "Perusahaan tidak ditemukan", "NOT_FOUND");
  return c;
}

function serialize(c) {
  return {
    companyId: c.id,
    name: c.name,
    address: c.address,
    contact_email: c.contact_email,
    industry: c.industry,
    logo_url: c.logo_url,
    work_hours: { start: c.work_start, end: c.work_end },
  };
}

export function register(router) {
  // Detail profil perusahaan yang sedang dikelola.
  router.get("/api/company", requireControl, (ctx) => {
    json(ctx.res, 200, serialize(currentCompany(ctx)));
  });

  // Update profil (nama, alamat, jam kerja, logo, dll).
  router.put("/api/company", requireControl, (ctx) => {
    currentCompany(ctx);
    const b = ctx.body;
    const fields = pick(b, ["name", "address", "contact_email", "industry", "logo_url"]);
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) { sets.push(`${k} = ?`); vals.push(v); }
    if (b.work_hours?.start) { sets.push("work_start = ?"); vals.push(b.work_hours.start); }
    if (b.work_hours?.end) { sets.push("work_end = ?"); vals.push(b.work_hours.end); }
    assert(sets.length > 0, 400, "Tidak ada field yang diperbarui");
    run(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`, ...vals, ctx.auth.companyId);
    audit(ctx, "company.update", Object.keys(fields));
    json(ctx.res, 200, { message: "Company profile updated" });
  });

  // Unggah/perbarui logo. Tanpa parser multipart, kami terima { logo_url } atau
  // data URL base64 di body JSON — cukup untuk integrasi frontend tanpa storage.
  router.post("/api/company/logo", requireControl, (ctx) => {
    const url = ctx.body.logo_url || ctx.body.logo;
    assert(typeof url === "string" && url.length > 0, 400, "logo_url / logo wajib diisi");
    assert(url.length <= MAX_LOGO_LEN, 413, "Logo terlalu besar (maks ~2MB)");
    run("UPDATE companies SET logo_url = ? WHERE id = ?", url, ctx.auth.companyId);
    audit(ctx, "company.logo");
    json(ctx.res, 200, { message: "Logo updated", logo_url: url });
  });

  // Konfigurasi aplikasi: zona waktu, mode presensi, bahasa.
  router.get("/api/company/settings", requireControl, (ctx) => {
    const c = currentCompany(ctx);
    json(ctx.res, 200, {
      timezone: c.timezone,
      attendance_mode: c.attendance_mode,
      language: c.language,
    });
  });

  router.put("/api/company/settings", requireControl, (ctx) => {
    currentCompany(ctx);
    const b = ctx.body;
    const sets = [];
    const vals = [];
    if (b.timezone !== undefined) {
      assert(safeTz(b.timezone), 400, "Zona waktu tidak dikenal (pakai nama IANA, mis. Asia/Jakarta)");
      sets.push("timezone = ?"); vals.push(b.timezone);
    }
    if (b.language !== undefined) { sets.push("language = ?"); vals.push(b.language); }
    if (b.attendance_mode !== undefined) {
      assert(ATTENDANCE_MODES.includes(b.attendance_mode), 400,
        `attendance_mode harus salah satu: ${ATTENDANCE_MODES.join(", ")}`);
      sets.push("attendance_mode = ?"); vals.push(b.attendance_mode);
    }
    assert(sets.length > 0, 400, "Tidak ada konfigurasi yang diperbarui");
    run(`UPDATE companies SET ${sets.join(", ")} WHERE id = ?`, ...vals, ctx.auth.companyId);
    audit(ctx, "company.settings", b);
    const c = currentCompany(ctx);
    json(ctx.res, 200, {
      timezone: c.timezone, attendance_mode: c.attendance_mode, language: c.language,
    });
  });
}
