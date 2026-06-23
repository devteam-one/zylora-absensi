// ─── 4.1. Lokasi & QR/Barcode Perusahaan ──────────────────────────────────────
import { json, noContent, ApiError } from "../lib/http.mjs";
import { requireFields, assert } from "../lib/validate.mjs";
import { get, all, run } from "../lib/db.mjs";
import { genId, nowISO } from "../lib/security.mjs";
import { staticToken, dynamicToken, qrImageUrl } from "../lib/qr.mjs";
import { requireControl, audit } from "../lib/middleware.mjs";

function ownedLocation(ctx, id) {
  const loc = get("SELECT * FROM locations WHERE id = ? AND company_id = ?", id, ctx.auth.companyId);
  if (!loc) throw new ApiError(404, "Lokasi tidak ditemukan", "NOT_FOUND");
  return loc;
}

function ownedCode(ctx, locationId, codeId) {
  ownedLocation(ctx, locationId);
  const code = get("SELECT * FROM location_codes WHERE id = ? AND location_id = ?", codeId, locationId);
  if (!code) throw new ApiError(404, "Kode tidak ditemukan", "NOT_FOUND");
  return code;
}

// Untuk kode dinamis, token selalu dihitung ulang sesuai jendela waktu saat ini.
function liveToken(code) {
  return code.type === "qr_dynamic"
    ? dynamicToken(code.location_id, code.interval || "hourly", code.serial || 0)
    : code.token;
}

function serializeCode(code) {
  const token = liveToken(code);
  return {
    codeId: code.id,
    locationId: code.location_id,
    type: code.type,
    status: code.status,
    interval: code.interval,
    serial: code.type === "qr_dynamic" ? (code.serial || 0) : null,
    token,
    qrImageUrl: qrImageUrl(token),
    active_hours: code.active_start ? { start: code.active_start, end: code.active_end } : null,
    expires_at: code.expires_at,
  };
}

export function register(router) {
  // Tambah lokasi absensi (cabang/ruangan) + titik GPS untuk validasi LBS.
  router.post("/api/locations", requireControl, (ctx) => {
    const b = ctx.body;
    requireFields(b, ["name"]);
    const id = genId("loc");
    run(
      `INSERT INTO locations (id, company_id, name, address, type, lat, lng, radius_m, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      id, ctx.auth.companyId, b.name, b.address || null, b.type || "office",
      b.lat ?? null, b.lng ?? null, b.radius_m ?? 100, nowISO(),
    );
    audit(ctx, "location.create", { id });
    json(ctx.res, 201, { locationId: id });
  });

  router.get("/api/locations", requireControl, (ctx) => {
    const rows = all("SELECT * FROM locations WHERE company_id = ? ORDER BY name", ctx.auth.companyId);
    json(ctx.res, 200, rows.map((l) => ({
      locationId: l.id, name: l.name, address: l.address, type: l.type,
      lat: l.lat, lng: l.lng, radius_m: l.radius_m,
    })));
  });

  // Update lokasi (nama, alamat, tipe, koordinat GPS, radius).
  router.put("/api/locations/:locationId", requireControl, (ctx) => {
    ownedLocation(ctx, ctx.params.locationId);
    const b = ctx.body;
    const sets = [];
    const vals = [];
    for (const k of ["name", "address", "type"]) {
      if (b[k] !== undefined) { sets.push(`${k} = ?`); vals.push(b[k]); }
    }
    if (b.lat !== undefined) { sets.push("lat = ?"); vals.push(b.lat === null ? null : Number(b.lat)); }
    if (b.lng !== undefined) { sets.push("lng = ?"); vals.push(b.lng === null ? null : Number(b.lng)); }
    if (b.radius_m !== undefined) {
      assert(Number(b.radius_m) >= 0, 400, "radius_m tidak boleh negatif");
      sets.push("radius_m = ?"); vals.push(Number(b.radius_m));
    }
    assert(sets.length > 0, 400, "Tidak ada field yang diperbarui");
    run(`UPDATE locations SET ${sets.join(", ")} WHERE id = ?`, ...vals, ctx.params.locationId);
    audit(ctx, "location.update", { id: ctx.params.locationId });
    const l = ownedLocation(ctx, ctx.params.locationId);
    json(ctx.res, 200, {
      locationId: l.id, name: l.name, address: l.address, type: l.type,
      lat: l.lat, lng: l.lng, radius_m: l.radius_m,
    });
  });

  // Hapus lokasi. Kode QR ikut terhapus (FK CASCADE); presensi lama tetap ada
  // (location_id → NULL via FK SET NULL), jadi riwayat absensi tidak hilang.
  router.delete("/api/locations/:locationId", requireControl, (ctx) => {
    ownedLocation(ctx, ctx.params.locationId);
    run("DELETE FROM locations WHERE id = ?", ctx.params.locationId);
    audit(ctx, "location.delete", { id: ctx.params.locationId });
    noContent(ctx.res);
  });

  // Generate QR statis (untuk dicetak & ditempel).
  router.post("/api/locations/:locationId/codes", requireControl, (ctx) => {
    ownedLocation(ctx, ctx.params.locationId);
    // Satu kode statis aktif per lokasi: nonaktifkan yang lama agar tak menumpuk.
    run("UPDATE location_codes SET status = 'inactive', updated_at = ? WHERE location_id = ? AND type = 'qr_static' AND status = 'active'",
      nowISO(), ctx.params.locationId);
    const id = genId("code");
    const token = staticToken(ctx.params.locationId);
    run(
      `INSERT INTO location_codes (id, location_id, type, token, status, expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      id, ctx.params.locationId, "qr_static", token, "active",
      ctx.body.expires_at || null, nowISO(), nowISO(),
    );
    audit(ctx, "code.static.create", { locationId: ctx.params.locationId, codeId: id });
    json(ctx.res, 201, { codeId: id, qrImageUrl: qrImageUrl(token) });
  });

  // Generate QR dinamis (berputar otomatis tiap interval).
  router.post("/api/locations/:locationId/codes/dynamic", requireControl, (ctx) => {
    ownedLocation(ctx, ctx.params.locationId);
    // Satu kode dinamis aktif per lokasi: nonaktifkan yang lama agar tak menumpuk.
    run("UPDATE location_codes SET status = 'inactive', updated_at = ? WHERE location_id = ? AND type = 'qr_dynamic' AND status = 'active'",
      nowISO(), ctx.params.locationId);
    const b = ctx.body;
    const interval = b.interval === "daily" ? "daily" : "hourly";
    const id = genId("code");
    const token = dynamicToken(ctx.params.locationId, interval);
    run(
      `INSERT INTO location_codes (id, location_id, type, token, status, interval, active_start, active_end, expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      id, ctx.params.locationId, "qr_dynamic", token, "active", interval,
      b.active_hours?.start || null, b.active_hours?.end || null,
      b.expires_in ? new Date(Date.now() + b.expires_in * 1000).toISOString() : null,
      nowISO(), nowISO(),
    );
    audit(ctx, "code.dynamic.create", { locationId: ctx.params.locationId, codeId: id });
    json(ctx.res, 201, { codeId: id, type: "qr_dynamic", interval, qrImageUrl: qrImageUrl(token) });
  });

  // Detail & status kode.
  router.get("/api/locations/:locationId/codes/:codeId", requireControl, (ctx) => {
    json(ctx.res, 200, serializeCode(ownedCode(ctx, ctx.params.locationId, ctx.params.codeId)));
  });

  // Update pengaturan kode (aktif/non-aktif, jadwal).
  router.put("/api/locations/:locationId/codes/:codeId", requireControl, (ctx) => {
    ownedCode(ctx, ctx.params.locationId, ctx.params.codeId);
    const b = ctx.body;
    const sets = [];
    const vals = [];
    if (b.status !== undefined) {
      assert(["active", "inactive"].includes(b.status), 400, "status: active|inactive");
      sets.push("status = ?"); vals.push(b.status);
    }
    if (b.interval !== undefined) { sets.push("interval = ?"); vals.push(b.interval); }
    if (b.active_hours?.start !== undefined) { sets.push("active_start = ?"); vals.push(b.active_hours.start); }
    if (b.active_hours?.end !== undefined) { sets.push("active_end = ?"); vals.push(b.active_hours.end); }
    assert(sets.length > 0, 400, "Tidak ada field yang diperbarui");
    sets.push("updated_at = ?"); vals.push(nowISO());
    run(`UPDATE location_codes SET ${sets.join(", ")} WHERE id = ?`, ...vals, ctx.params.codeId);
    audit(ctx, "code.update", { codeId: ctx.params.codeId });
    json(ctx.res, 200, serializeCode(ownedCode(ctx, ctx.params.locationId, ctx.params.codeId)));
  });

  // Regenerasi QR dinamis manual (paksa token jendela baru).
  router.post("/api/locations/:locationId/codes/:codeId/refresh", requireControl, (ctx) => {
    const code = ownedCode(ctx, ctx.params.locationId, ctx.params.codeId);
    assert(code.type === "qr_dynamic", 400, "Hanya kode dinamis yang bisa di-refresh", "NOT_DYNAMIC");
    const newSerial = (code.serial || 0) + 1;
    const token = dynamicToken(ctx.params.locationId, code.interval || "hourly", newSerial);
    const expires_at = new Date(Date.now() + (code.interval === "daily" ? 86400 : 3600) * 1000).toISOString();
    run("UPDATE location_codes SET serial = ?, token = ?, expires_at = ?, updated_at = ? WHERE id = ?",
      newSerial, token, expires_at, nowISO(), ctx.params.codeId);
    audit(ctx, "code.refresh", { codeId: ctx.params.codeId, serial: newSerial });
    json(ctx.res, 200, { newCode: token, serial: newSerial, qrImageUrl: qrImageUrl(token), expires_at });
  });

  // Hapus kode QR/barcode sebuah lokasi.
  router.delete("/api/locations/:locationId/codes/:codeId", requireControl, (ctx) => {
    ownedCode(ctx, ctx.params.locationId, ctx.params.codeId);
    run("DELETE FROM location_codes WHERE id = ?", ctx.params.codeId);
    audit(ctx, "code.delete", { codeId: ctx.params.codeId });
    noContent(ctx.res);
  });
}
