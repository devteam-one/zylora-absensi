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
    // MULTI-TENANT: endpoint ini WAJIB di-scope. Tanpa filter, query mengembalikan
    // kode aktif ter-baru SECARA GLOBAL lintas perusahaan — membocorkan nama lokasi,
    // GPS, dan token QR live milik tenant lain ke pemanggil anonim, sekaligus salah
    // menampilkan QR di display multi-lokasi. Pemanggil harus menyebut lokasi/
    // perusahaan yang dituju (display dikonfigurasi via VITE_LOCATION_ID/COMPANY_ID;
    // app karyawan & panel kontrol mengirim companyId miliknya).
    const locationId = ctx.query.location;
    const companyId = ctx.query.company;
    if (!locationId && !companyId) {
      throw new ApiError(400, "Specify ?location=<id> or ?company=<id>", "SCOPE_REQUIRED");
    }
    // Utamakan kode DINAMIS (sekali-pakai/anti-replay) untuk ditampilkan; statis
    // hanya fallback bila tak ada dinamis aktif.
    const code = locationId
      ? get(`
        SELECT lc.*, l.name AS loc_name, l.lat, l.lng, l.radius_m
        FROM location_codes lc JOIN locations l ON l.id = lc.location_id
        WHERE lc.status = 'active' AND lc.location_id = ?
        ORDER BY (lc.type = 'qr_dynamic') DESC, lc.created_at DESC LIMIT 1`, locationId)
      : get(`
        SELECT lc.*, l.name AS loc_name, l.lat, l.lng, l.radius_m
        FROM location_codes lc JOIN locations l ON l.id = lc.location_id
        WHERE lc.status = 'active' AND l.company_id = ?
        ORDER BY (lc.type = 'qr_dynamic') DESC, lc.created_at DESC LIMIT 1`, companyId);
    if (!code) throw new ApiError(404, "No active location/code", "NO_LOCATION");

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
