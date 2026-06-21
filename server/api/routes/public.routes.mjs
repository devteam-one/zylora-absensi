// ─── Endpoint publik (kiosk / app karyawan) ───────────────────────────────────
// QR lokasi memang ditampilkan/ditempel di tempat umum, jadi token + koordinat
// lokasi boleh diambil tanpa auth. Token saja TIDAK cukup untuk absen — tetap
// butuh kode personal karyawan + posisi GPS dalam radius (lihat attendance.routes).
import { json, ApiError } from "../lib/http.mjs";
import { get } from "../lib/db.mjs";
import { dynamicToken, qrImageUrl } from "../lib/qr.mjs";

export function register(router) {
  // Lokasi aktif + token QR live untuk ditampilkan/dipindai.
  router.get("/api/public/location", (ctx) => {
    const code = get(`
      SELECT lc.*, l.name AS loc_name, l.lat, l.lng, l.radius_m
      FROM location_codes lc JOIN locations l ON l.id = lc.location_id
      WHERE lc.status = 'active'
      ORDER BY lc.created_at DESC LIMIT 1`);
    if (!code) throw new ApiError(404, "Belum ada lokasi/kode aktif", "NO_LOCATION");

    const token = code.type === "qr_dynamic"
      ? dynamicToken(code.location_id, code.interval || "hourly", code.serial || 0)
      : code.token;

    json(ctx.res, 200, {
      locationId: code.location_id,
      name: code.loc_name,
      lat: code.lat,
      lng: code.lng,
      radius_m: code.radius_m,
      type: code.type,
      token,
      serial: code.type === "qr_dynamic" ? (code.serial || 0) : null,
      qrImageUrl: qrImageUrl(token),
    });
  });
}
