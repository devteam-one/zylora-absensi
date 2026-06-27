// ─────────────────────────────────────────────────────────────────────────────
// Logika inti presensi, dipakai bersama oleh:
//   • attendance.routes (publik/kiosk — identitas via kode personal yang dipindai)
//   • employee.routes   (app karyawan — identitas via JWT peran 'employee')
// Validasi: keabsahan QR lokasi (statis/dinamis) + posisi GPS dalam radius.
// ─────────────────────────────────────────────────────────────────────────────
import { get, run } from "./db.mjs";
import { genId, nowISO } from "./security.mjs";
import { isValidDynamicToken, serialOf } from "./qr.mjs";
import { ApiError } from "./http.mjs";
import { assert } from "./validate.mjs";

// Tanggal & jam OPERASIONAL dihitung di ZONA WAKTU PERUSAHAAN — BUKAN UTC. Di
// server UTC, new Date().toISOString() membuat absen pagi WIB tercatat sebagai
// tanggal kemarin & jam keliru → status hadir/terlambat dan payroll ikut salah.
// Zona diambil dari companies.timezone (lihat companyTz); ZYLORA_TZ jadi default
// global bila perusahaan tak punya zona / zonanya tak dikenal.
const DEFAULT_TZ = safeTz(process.env.ZYLORA_TZ) || "Asia/Jakarta";

// Formatter di-cache per zona (pembuatan Intl relatif mahal).
const fmtCache = new Map();
function fmtFor(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = {
      date: new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }),
      time: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    };
    fmtCache.set(tz, f);
  }
  return f;
}

// Validasi nama zona IANA; null bila tak dikenal (cegah throw saat memformat).
export function safeTz(tz) {
  if (!tz || typeof tz !== "string") return null;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: tz }); return tz; } catch { return null; }
}

// Zona waktu efektif sebuah perusahaan (fallback ke default global).
export function companyTz(companyId) {
  const row = companyId ? get("SELECT timezone FROM companies WHERE id = ?", companyId) : null;
  return safeTz(row?.timezone) || DEFAULT_TZ;
}

// "YYYY-MM-DD" (en-CA) & "HH:MM" 24-jam (en-GB, 00–23) pada zona tertentu.
export const todayStr = (d = new Date()) => fmtFor(DEFAULT_TZ).date.format(d);
export const hhmm = (d = new Date()) => fmtFor(DEFAULT_TZ).time.format(d);
export const todayStrTz = (tz, d = new Date()) => fmtFor(safeTz(tz) || DEFAULT_TZ).date.format(d);
export const hhmmTz = (tz, d = new Date()) => fmtFor(safeTz(tz) || DEFAULT_TZ).time.format(d);

// "HH:MM" → menit sejak 00:00 (null bila tak valid).
export const toMin = (hhmm) => {
  if (!hhmm || typeof hhmm !== "string") return null;
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
// Menit keterlambatan, MENANGANI shift lintas tengah malam (schedOut < schedIn).
// Normal (08:00–17:00): telat = checkin − masuk. Overnight (23:00–08:00):
// check-in sore ≥ masuk → telat = selisih; check-in pagi (≤ keluar) → telat =
// checkin + 1440 − masuk; di jeda siang dianggap datang awal (0).
export function lateMinutes(ci, schedIn, schedOut) {
  if (ci == null || schedIn == null) return 0;
  const overnight = schedOut != null && schedOut < schedIn;
  if (!overnight) return ci > schedIn ? ci - schedIn : 0;
  if (ci >= schedIn) return ci - schedIn;
  if (schedOut != null && ci <= schedOut) return ci + 1440 - schedIn;
  return 0;
}

// Jarak dua titik GPS dalam meter (haversine).
export function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6_371_000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Cari lokasi sah dari token QR (statis exact-match / dinamis dalam jendela waktu).
export function resolveLocation(token) {
  if (typeof token !== "string") throw new ApiError(400, "Location token is required", "NO_TOKEN");
  if (token.startsWith("ZYL-DYN-")) {
    const locationId = token.split("-")[2];
    const code = get(
      "SELECT * FROM location_codes WHERE location_id = ? AND type = 'qr_dynamic' AND status = 'active'",
      locationId,
    );
    if (code && isValidDynamicToken(token, locationId, code.interval || "hourly", code.serial || 0)) {
      return get("SELECT * FROM locations WHERE id = ?", locationId);
    }
    // Seri token tak cocok = QR sudah dipindai (sekali pakai) atau kedaluwarsa.
    const used = code && serialOf(token) != null && serialOf(token) < (code.serial || 0);
    throw new ApiError(400, used
      ? "QR already scanned (single-use) — get the latest QR on the location screen"
      : "Dynamic QR expired or invalid", "BAD_QR");
  }
  const code = get("SELECT * FROM location_codes WHERE token = ? AND status = 'active'", token);
  if (!code) throw new ApiError(400, "Invalid location QR", "BAD_QR");
  return get("SELECT * FROM locations WHERE id = ?", code.location_id);
}

// Validasi posisi terhadap radius lokasi (dilewati bila lokasi tak punya koordinat).
// PENTING: koordinat di-coerce & divalidasi finite + dalam rentang dulu. Tanpa ini,
// nilai non-numerik (mis. "spoof") membuat distanceM => NaN dan `NaN > radius` === false
// → geofence ter-bypass (check-in palsu dari mana saja).
export function checkGeo(loc, lat, lng) {
  if (loc.lat == null || loc.lng == null) return;
  const la = Number(lat), ln = Number(lng);
  assert(
    Number.isFinite(la) && Number.isFinite(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180,
    400, "Valid GPS coordinates are required", "NO_GPS",
  );
  const dist = distanceM(loc.lat, loc.lng, la, ln);
  if (dist > loc.radius_m) {
    throw new ApiError(403, `Outside location radius (${Math.round(dist)}m > ${loc.radius_m}m)`, "OUT_OF_RANGE");
  }
}

// Cuti/izin/sakit DISETUJUI yang mencakup tanggal tsb (jika ada). Tanggal ISO
// (YYYY-MM-DD) aman dibandingkan secara leksikografis.
export function approvedLeaveOn(employeeId, date) {
  return get(
    `SELECT type, start_date, end_date FROM leave_requests
     WHERE employee_id = ? AND status = 'approved'
       AND start_date <= ? AND end_date >= ? LIMIT 1`,
    employeeId, date, date,
  );
}

// Naikkan nomor seri QR dinamis aktif sebuah lokasi → token yang barusan dipindai
// jadi tak valid (sekali pakai); layar lokasi otomatis menampilkan QR seri baru.
export function bumpCodeSerial(locationId) {
  if (!locationId) return;
  run("UPDATE location_codes SET serial = serial + 1, updated_at = ? WHERE location_id = ? AND type = 'qr_dynamic' AND status = 'active'",
    nowISO(), locationId);
}

// Catat check-in untuk satu karyawan (emp = baris penuh). Melempar 409 bila sudah.
export function recordCheckin(emp, loc, { lat, lng, method } = {}) {
  // Cegah check-in lintas-tenant: lokasi harus milik perusahaan karyawan.
  if (!loc || loc.company_id !== emp.company_id) {
    throw new ApiError(403, "Location belongs to a different company", "WRONG_COMPANY");
  }
  const tz = companyTz(emp.company_id);
  const date = todayStrTz(tz);

  // Tolak bila karyawan resmi cuti/izin/sakit (disetujui) pada tanggal ini:
  // tanpa ini catatan jadi kontradiktif — mis. ditandai "terlambat" padahal sah
  // tidak masuk. Presensi & cuti dua tabel terpisah, jadi direkonsiliasi di sini.
  const leave = approvedLeaveOn(emp.id, date);
  if (leave) {
    throw new ApiError(409, `On ${leave.type} (approved) today — no need to check in`, "ON_LEAVE");
  }

  const time = hhmmTz(tz);
  // Sadar shift lintas tengah malam (mis. 23:00–08:00) — bukan sekadar string compare.
  const status = lateMinutes(toMin(time), toMin(emp.schedule_in || "08:00"), toMin(emp.schedule_out)) > 0 ? "terlambat" : "hadir";
  const m = method === "terminal" ? "terminal" : "qr_lokasi";

  const existing = get("SELECT * FROM attendance WHERE employee_id = ? AND date = ?", emp.id, date);
  if (existing?.check_in) throw new ApiError(409, "Already checked in today", "ALREADY_IN");

  if (existing) {
    run("UPDATE attendance SET check_in = ?, status = ?, method = ?, location_id = ?, lat = ?, lng = ? WHERE id = ?",
      time, status, m, loc.id, lat ?? null, lng ?? null, existing.id);
  } else {
    run(
      `INSERT INTO attendance (id, company_id, employee_id, date, check_in, status, method, location_id, lat, lng, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      genId("att"), emp.company_id, emp.id, date, time, status, m, loc.id, lat ?? null, lng ?? null, nowISO(),
    );
  }
  bumpCodeSerial(loc.id); // tiap scan → seri QR berganti (anti-replay)
  return { employeeId: emp.id, name: emp.name, date, check_in: time, status, location: loc.name, method: m };
}

// Catat check-out. Melempar 409 bila belum check-in hari ini.
export function recordCheckout(emp, loc) {
  // Cegah check-out lintas-tenant (selaras dengan check-in).
  if (!loc || loc.company_id !== emp.company_id) {
    throw new ApiError(403, "Location belongs to a different company", "WRONG_COMPANY");
  }
  const tz = companyTz(emp.company_id);
  const date = todayStrTz(tz);
  const rec = get("SELECT * FROM attendance WHERE employee_id = ? AND date = ?", emp.id, date);
  if (!rec?.check_in) throw new ApiError(409, "Not checked in today", "NOT_IN");
  const time = hhmmTz(tz);
  run("UPDATE attendance SET check_out = ? WHERE id = ?", time, rec.id);
  if (loc) bumpCodeSerial(loc.id); // scan checkout → seri berganti juga
  return { employeeId: emp.id, date, check_out: time };
}

// Status presensi karyawan hari ini (untuk GET /api/me).
export function todayStatus(employeeId) {
  const emp = get("SELECT company_id FROM employees WHERE id = ?", employeeId);
  const date = todayStrTz(companyTz(emp?.company_id));
  const rec = get("SELECT check_in, check_out, status FROM attendance WHERE employee_id = ? AND date = ?",
    employeeId, date);
  return rec || null;
}
