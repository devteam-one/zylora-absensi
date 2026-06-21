// ─────────────────────────────────────────────────────────────────────────────
// Logika inti presensi, dipakai bersama oleh:
//   • attendance.routes (publik/kiosk — identitas via kode personal yang dipindai)
//   • employee.routes   (app karyawan — identitas via JWT peran 'employee')
// Validasi: keabsahan QR lokasi (statis/dinamis) + posisi GPS dalam radius.
// ─────────────────────────────────────────────────────────────────────────────
import { get, run } from "./db.mjs";
import { genId, nowISO } from "./security.mjs";
import { isValidDynamicToken } from "./qr.mjs";
import { ApiError } from "./http.mjs";
import { assert } from "./validate.mjs";

export const todayStr = () => new Date().toISOString().slice(0, 10);
export const hhmm = () => new Date().toTimeString().slice(0, 5);

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

// Identifikasi karyawan dari kode personal ber-tanda-tangan (dipakai jalur kiosk).
export function resolveEmployeeByCode(code) {
  const row = get("SELECT employee_id FROM employee_codes WHERE code = ?", code);
  if (!row) throw new ApiError(401, "Kode karyawan tidak dikenal", "BAD_EMPLOYEE_CODE");
  const emp = get("SELECT * FROM employees WHERE id = ?", row.employee_id);
  if (!emp || emp.status !== "active") throw new ApiError(403, "Karyawan nonaktif", "INACTIVE");
  return emp;
}

// Cari lokasi sah dari token QR (statis exact-match / dinamis dalam jendela waktu).
export function resolveLocation(token) {
  if (typeof token !== "string") throw new ApiError(400, "Token lokasi wajib", "NO_TOKEN");
  if (token.startsWith("ZYL-DYN-")) {
    const locationId = token.split("-")[2];
    const code = get(
      "SELECT * FROM location_codes WHERE location_id = ? AND type = 'qr_dynamic' AND status = 'active'",
      locationId,
    );
    if (code && isValidDynamicToken(token, locationId, code.interval || "hourly")) {
      return get("SELECT * FROM locations WHERE id = ?", locationId);
    }
    throw new ApiError(400, "QR dinamis kedaluwarsa atau tidak valid", "BAD_QR");
  }
  const code = get("SELECT * FROM location_codes WHERE token = ? AND status = 'active'", token);
  if (!code) throw new ApiError(400, "QR lokasi tidak valid", "BAD_QR");
  return get("SELECT * FROM locations WHERE id = ?", code.location_id);
}

// Validasi posisi terhadap radius lokasi (dilewati bila lokasi tak punya koordinat).
export function checkGeo(loc, lat, lng) {
  if (loc.lat == null || loc.lng == null) return;
  assert(lat != null && lng != null, 400, "Koordinat GPS wajib dikirim", "NO_GPS");
  const dist = distanceM(loc.lat, loc.lng, lat, lng);
  if (dist > loc.radius_m) {
    throw new ApiError(403, `Di luar radius lokasi (${Math.round(dist)}m > ${loc.radius_m}m)`, "OUT_OF_RANGE");
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

// Catat check-in untuk satu karyawan (emp = baris penuh). Melempar 409 bila sudah.
export function recordCheckin(emp, loc, { lat, lng, method } = {}) {
  const date = todayStr();

  // Tolak bila karyawan resmi cuti/izin/sakit (disetujui) pada tanggal ini:
  // tanpa ini catatan jadi kontradiktif — mis. ditandai "terlambat" padahal sah
  // tidak masuk. Presensi & cuti dua tabel terpisah, jadi direkonsiliasi di sini.
  const leave = approvedLeaveOn(emp.id, date);
  if (leave) {
    throw new ApiError(409, `Sedang ${leave.type} (disetujui) hari ini — tidak perlu absen`, "ON_LEAVE");
  }

  const time = hhmm();
  const status = time > (emp.schedule_in || "08:00") ? "terlambat" : "hadir";
  const m = method === "terminal" ? "terminal" : "qr_lokasi";

  const existing = get("SELECT * FROM attendance WHERE employee_id = ? AND date = ?", emp.id, date);
  if (existing?.check_in) throw new ApiError(409, "Sudah check-in hari ini", "ALREADY_IN");

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
  return { employeeId: emp.id, name: emp.name, date, check_in: time, status, location: loc.name, method: m };
}

// Catat check-out. Melempar 409 bila belum check-in hari ini.
export function recordCheckout(emp) {
  const date = todayStr();
  const rec = get("SELECT * FROM attendance WHERE employee_id = ? AND date = ?", emp.id, date);
  if (!rec?.check_in) throw new ApiError(409, "Belum check-in hari ini", "NOT_IN");
  const time = hhmm();
  run("UPDATE attendance SET check_out = ? WHERE id = ?", time, rec.id);
  return { employeeId: emp.id, date, check_out: time };
}

// Status presensi karyawan hari ini (untuk GET /api/me).
export function todayStatus(employeeId) {
  const rec = get("SELECT check_in, check_out, status FROM attendance WHERE employee_id = ? AND date = ?",
    employeeId, todayStr());
  return rec || null;
}
