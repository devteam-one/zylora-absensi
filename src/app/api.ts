// ─────────────────────────────────────────────────────────────────────────────
// Klien REST untuk backend Zylora (server/api). Menggantikan mock state + relay
// SSE: backend kini jadi sumber kebenaran, frontend membaca/menulis lewat sini.
//
// Base URL default ke 127.0.0.2:5181 (host bind backend) agar tetap benar baik
// saat frontend dilayani dari 127.0.0.2 (dev:2port) maupun localhost (dev biasa).
// Override via VITE_API_URL bila perlu.
// ─────────────────────────────────────────────────────────────────────────────
const BASE =
  (import.meta as any).env?.VITE_API_URL || "http://127.0.0.2:5181";

export type ApiAttendanceRow = {
  employeeId: string; name: string; department: string;
  date: string; check_in: string | null; check_out: string | null;
  status: string; method: string | null;
};

export type ApiLeaveRow = {
  requestId: string; employeeId: string; employee_name: string;
  type: string; start_date: string; end_date: string;
  reason: string | null; status: string; notes: string | null;
};

export type ApiPublicLocation = {
  locationId: string; name: string; lat: number | null; lng: number | null;
  radius_m: number; type: string; token: string; qrImageUrl: string;
};

export type ApiMe = {
  employeeId: string; name: string; position: string; department: string;
  schedule: { in: string; out: string };
  code: string | null; codeImageUrl: string | null;
  today: { check_in: string | null; check_out: string | null; status: string } | null;
};

export type ApiEmployee = {
  employeeId: string; name: string; email: string | null;
  position: string | null; department: string | null;
  start_date: string | null; status: string;
  schedule: { in: string | null; out: string | null };
  barcode: string | null;
};

export type EmployeeInput = {
  name?: string; email?: string | null; position?: string | null;
  department?: string | null; start_date?: string | null; status?: string;
  schedule_in?: string; schedule_out?: string;
};

export type ApiLocation = {
  locationId: string; name: string; address: string | null;
  type: string; lat: number | null; lng: number | null; radius_m: number;
};

export type LocationInput = {
  name?: string; address?: string | null; type?: string;
  lat?: number | null; lng?: number | null; radius_m?: number;
};

type ReqOpts = { method?: string; token?: string | null; body?: unknown };

async function req<T = any>(path: string, opts: ReqOpts = {}): Promise<T> {
  const { method = "GET", token, body } = opts;
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error?.message || `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  base: BASE,

  // Auth sistem kontrol
  controlLogin: (email: string, password: string) =>
    req<{ token: string; expires_in: number }>("/api/control/login", {
      method: "POST", body: { email, password },
    }),
  controlLogout: (token: string) =>
    req("/api/control/logout", { method: "POST", token }),
  controlRegister: (body: { name: string; email: string; password: string; company_name: string }) =>
    req<{ adminId: string; companyId: string }>("/api/control/register", { method: "POST", body }),

  // Dashboard admin (butuh token)
  attendance: (token: string, date?: string) =>
    req<ApiAttendanceRow[]>(`/api/attendance${date ? `?date=${date}` : ""}`, { token }),
  leaves: (token: string) =>
    req<ApiLeaveRow[]>("/api/leaves/requests", { token }),
  approveLeave: (token: string, id: string, approved: boolean, notes?: string) =>
    req(`/api/leaves/${id}/approve`, { method: "POST", token, body: { approved, notes } }),
  employeeCode: (token: string, employeeId: string) =>
    req<{ code: string; imageUrl: string; format: string }>(
      `/api/employees/${employeeId}/code`, { token }),

  // Manajemen karyawan (admin / Sistem Kontrol)
  employees: (token: string, query?: string) =>
    req<ApiEmployee[]>(`/api/employees${query ? `?${query}` : ""}`, { token }),
  createEmployee: (token: string, body: EmployeeInput) =>
    req<{ employeeId: string }>("/api/employees", { method: "POST", token, body }),
  updateEmployee: (token: string, id: string, body: EmployeeInput) =>
    req<ApiEmployee>(`/api/employees/${id}`, { method: "PUT", token, body }),
  deleteEmployee: (token: string, id: string, soft = false) =>
    req(`/api/employees/${id}${soft ? "?soft=true" : ""}`, { method: "DELETE", token }),
  setEmployeeCode: (token: string, id: string, format: "qr" | "barcode" = "qr") =>
    req<{ code: string; imageUrl: string; format: string }>(
      `/api/employees/${id}/code`, { method: "POST", token, body: { format } }),
  resetEmployeeCode: (token: string, id: string) =>
    req(`/api/employees/${id}/code/reset`, { method: "POST", token }),

  // Manajemen lokasi & QR (admin / Sistem Kontrol)
  locations: (token: string) => req<ApiLocation[]>("/api/locations", { token }),
  createLocation: (token: string, body: LocationInput) =>
    req<{ locationId: string }>("/api/locations", { method: "POST", token, body }),
  createDynamicCode: (token: string, locationId: string, interval: "hourly" | "daily" = "hourly") =>
    req<{ codeId: string; type: string; interval: string; qrImageUrl: string }>(
      `/api/locations/${locationId}/codes/dynamic`, { method: "POST", token, body: { interval } }),
  createStaticCode: (token: string, locationId: string) =>
    req<{ codeId: string; qrImageUrl: string }>(
      `/api/locations/${locationId}/codes`, { method: "POST", token, body: {} }),
  refreshCode: (token: string, locationId: string, codeId: string) =>
    req<{ newCode: string; qrImageUrl: string; expires_at: string }>(
      `/api/locations/${locationId}/codes/${codeId}/refresh`, { method: "POST", token }),
  updateCode: (token: string, locationId: string, codeId: string, body: { status?: "active" | "inactive"; interval?: string }) =>
    req(`/api/locations/${locationId}/codes/${codeId}`, { method: "PUT", token, body }),

  // Shift kerja
  shifts: (token: string) => req<Array<{ shiftId: string; name: string; start: string; end: string }>>("/api/shifts", { token }),
  createShift: (token: string, body: { name: string; start: string; end: string }) =>
    req<{ shiftId: string }>("/api/shifts", { method: "POST", token, body }),
  updateShift: (token: string, id: string, body: { name?: string; start?: string; end?: string }) =>
    req(`/api/shifts/${id}`, { method: "PUT", token, body }),

  // Perangkat terdaftar
  devices: (token: string) => req<Array<{ id: string; employeeId: string; deviceId: string; label: string | null; created_at: string }>>("/api/devices", { token }),
  createDevice: (token: string, body: { employeeId: string; deviceId: string; label?: string }) =>
    req<{ id: string }>("/api/devices", { method: "POST", token, body }),

  // Profil & pengaturan perusahaan
  company: (token: string) => req<{ companyId: string; name: string; address: string | null; contact_email: string | null; industry: string | null; logo_url: string | null; work_hours: { start: string; end: string } }>("/api/company", { token }),
  updateCompany: (token: string, body: Record<string, unknown>) =>
    req("/api/company", { method: "PUT", token, body }),
  companySettings: (token: string) => req<{ timezone: string; attendance_mode: string; language: string }>("/api/company/settings", { token }),
  updateCompanySettings: (token: string, body: { timezone?: string; attendance_mode?: string; language?: string }) =>
    req("/api/company/settings", { method: "PUT", token, body }),
  setLogo: (token: string, logo_url: string) =>
    req("/api/company/logo", { method: "POST", token, body: { logo_url } }),
  registerCompany: (token: string, body: { company_name: string; address?: string; contact_email?: string; industry?: string }) =>
    req<{ companyId: string }>("/api/company/register", { method: "POST", token, body }),

  // Riwayat presensi per karyawan
  employeeAttendance: (token: string, id: string, q?: { start?: string; end?: string }) =>
    req<Array<{ date: string; check_in: string | null; check_out: string | null; status: string; method: string | null }>>(
      `/api/employees/${id}/attendance${q && (q.start || q.end) ? `?${new URLSearchParams(q as Record<string, string>)}` : ""}`, { token }),

  // Log audit admin
  logs: (token: string) => req<Array<{ id: string; admin_id: string | null; action: string; detail: string | null; ip: string | null; created_at: string }>>("/api/logs", { token }),

  // Auth & self-service KARYAWAN (token peran 'employee', terpisah dari admin)
  employeeLogin: (employeeId: string, password: string) =>
    req<{ token: string; expires_in: number; employeeId: string; name: string }>(
      "/api/employee/login", { method: "POST", body: { employeeId, password } }),
  employeeLogout: (token: string) =>
    req("/api/employee/logout", { method: "POST", token }),
  me: (token: string) => req<ApiMe>("/api/me", { token }),
  meCheckin: (token: string, body: { location_token: string; lat?: number | null; lng?: number | null; method?: string }) =>
    req<{ check_in: string; status: string; location: string }>("/api/me/checkin", { method: "POST", token, body }),
  meCheckout: (token: string, body: { location_token: string; lat?: number | null; lng?: number | null }) =>
    req<{ check_out: string }>("/api/me/checkout", { method: "POST", token, body }),

  // Publik (kiosk / app karyawan)
  publicLocation: () => req<ApiPublicLocation>("/api/public/location"),

  // Presensi (dipanggil saat scan)
  checkin: (body: {
    employee_code: string; location_token: string;
    lat?: number | null; lng?: number | null; method?: string;
  }) => req("/api/attendance/checkin", { method: "POST", body }),
  checkout: (body: { employee_code: string; location_token: string }) =>
    req("/api/attendance/checkout", { method: "POST", body }),
};
