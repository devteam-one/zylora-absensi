// ─────────────────────────────────────────────────────────────────────────────
// Seed demo — mencerminkan mock data prototipe (App.tsx) supaya frontend bisa
// langsung tersambung ke data nyata. Hanya berjalan bila DB masih kosong.
// ─────────────────────────────────────────────────────────────────────────────
import { get, run, tx } from "./lib/db.mjs";
import { hashPassword, nowISO, genId } from "./lib/security.mjs";
import { dynamicToken, employeeCode, qrImageUrl } from "./lib/qr.mjs";

const COMPANY_ID = "co_demo";
const LOCATION_ID = "loc_jkt";
const CONTROL_EMAIL = "kontrol@nusantara.co.id";
const CONTROL_PASSWORD = "kontrol1234";
const EMPLOYEE_PIN = "123456"; // PIN demo untuk semua karyawan (login app karyawan)

const EMPLOYEES = [
  ["EMP001", "Budi Santoso", "Teknologi Informasi", "Software Engineer", "budi@nusantara.co.id", "08:00", "17:00"],
  ["EMP002", "Dewi Rahayu", "Sumber Daya Manusia", "HR Manager", "dewi@nusantara.co.id", "08:00", "17:00"],
  ["EMP003", "Ahmad Fauzi", "Keuangan", "Senior Akuntan", "ahmad@nusantara.co.id", "08:00", "17:00"],
  ["EMP004", "Siti Nurhaliza", "Marketing", "Marketing Manager", "siti@nusantara.co.id", "08:00", "17:00"],
  ["EMP005", "Rizki Pratama", "Operasional", "Supervisor", "rizki@nusantara.co.id", "07:00", "16:00"],
  ["EMP006", "Nisa Amalia", "Teknologi Informasi", "UI/UX Designer", "nisa@nusantara.co.id", "08:00", "17:00"],
  ["EMP007", "Hendra Wijaya", "Keuangan", "Finance Staff", "hendra@nusantara.co.id", "08:00", "17:00"],
  ["EMP008", "Maya Putri", "Marketing", "Content Creator", "maya@nusantara.co.id", "09:00", "18:00"],
];

const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

const ATTENDANCE = [
  ["EMP001", "07:58", null, "hadir", "terminal"],
  ["EMP002", "08:02", null, "hadir", "qr_lokasi"],
  ["EMP003", "08:47", null, "terlambat", "qr_lokasi"],
  ["EMP005", "06:54", "16:05", "hadir", "terminal"],
  ["EMP007", "07:59", null, "hadir", "terminal"],
];

const LEAVES = [
  ["EMP004", "izin", today, today, "Keperluan keluarga mendesak — orang tua sakit.", "approved"],
  ["EMP006", "cuti", today, tomorrow, "Cuti tahunan yang telah direncanakan.", "pending"],
  ["EMP003", "izin", tomorrow, tomorrow, "Pemeriksaan kesehatan rutin.", "pending"],
  ["EMP008", "cuti", today, today, "Urusan administrasi kependudukan.", "rejected"],
];

export function seedIfEmpty() {
  if (get("SELECT 1 FROM companies LIMIT 1")) return null; // sudah ada data

  const ts = nowISO();
  tx(() => {
    run(`INSERT INTO companies (id, name, address, contact_email, industry, work_start, work_end, timezone, attendance_mode, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      COMPANY_ID, "Nusantara Group", "Jl. Sudirman No. 1, Jakarta", CONTROL_EMAIL, "Teknologi",
      "08:00", "17:00", "Asia/Jakarta", "qr_dynamic", ts);

    run(`INSERT INTO admins (id, company_id, name, email, password_hash, role, created_at) VALUES (?,?,?,?,?,?,?)`,
      "ctrl_demo", COMPANY_ID, "Operator Sistem Kontrol", CONTROL_EMAIL, hashPassword(CONTROL_PASSWORD), "control", ts);

    // Lokasi kantor pusat dengan titik GPS Jakarta + radius 150m.
    run(`INSERT INTO locations (id, company_id, name, address, type, lat, lng, radius_m, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      LOCATION_ID, COMPANY_ID, "Kantor Pusat Jakarta", "Jl. Sudirman No. 1", "office",
      -6.2088, 106.8456, 150, ts);

    // QR dinamis (hourly) untuk lokasi tersebut.
    run(`INSERT INTO location_codes (id, location_id, type, token, status, interval, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      "code_jkt_dyn", LOCATION_ID, "qr_dynamic", dynamicToken(LOCATION_ID, "hourly"), "active", "hourly", ts, ts);

    const pinHash = hashPassword(EMPLOYEE_PIN);
    for (const [id, name, dept, pos, email, sin, sout] of EMPLOYEES) {
      run(`INSERT INTO employees (id, company_id, name, email, password_hash, position, department, status, schedule_in, schedule_out, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        id, COMPANY_ID, name, email, pinHash, pos, dept, "active", sin, sout, ts);
      const code = employeeCode(id, "qr");
      run(`INSERT INTO employee_codes (employee_id, format, code, secure, image_url, updated_at) VALUES (?,?,?,?,?,?)`,
        id, "qr", code, 1, qrImageUrl(code), ts);
    }

    for (const [empId, cin, cout, status, method] of ATTENDANCE) {
      run(`INSERT INTO attendance (id, company_id, employee_id, date, check_in, check_out, status, method, location_id, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        genId("att"), COMPANY_ID, empId, today, cin, cout, status, method, LOCATION_ID, ts);
    }

    for (const [empId, type, sd, ed, reason, status] of LEAVES) {
      run(`INSERT INTO leave_requests (id, company_id, employee_id, type, start_date, end_date, reason, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        genId("leave"), COMPANY_ID, empId, type, sd, ed, reason, status, ts);
    }
  });

  return { companyId: COMPANY_ID, controlEmail: CONTROL_EMAIL, controlPassword: CONTROL_PASSWORD, employeePin: EMPLOYEE_PIN };
}
