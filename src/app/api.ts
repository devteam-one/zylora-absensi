// ─────────────────────────────────────────────────────────────────────────────
// Klien REST untuk backend Zylora (server/api). Menggantikan mock state + relay
// SSE: backend kini jadi sumber kebenaran, frontend membaca/menulis lewat sini.
//
// Base URL diambil dari VITE_API_URL (di-bake saat build APK/web/desktop). Bila
// kosong, default ke backend PRODUKSI di EC2 — JANGAN diam-diam ke localhost,
// karena itu membuat build seakan "offline". Untuk dev lokal, set VITE_API_URL.
// ─────────────────────────────────────────────────────────────────────────────
const BASE =
  (import.meta as any).env?.VITE_API_URL || "https://api.13-218-74-178.sslip.io";

export type ApiDashboard = {
  today: { date: string; present: number; late: number; onLeave: number; absent: number; total: number; attendanceRate: number };
  trend: Array<{ date: string; checkedIn: number; late: number }>;
  pendingLeaves: number;
  locationCount: number;
  headcountByDept: Array<{ department: string; count: number }>;
  month: { period: string; lateIncidents: number; records: number };
  recentActivity: Array<{ action: string; detail: string | null; created_at: string }>;
};

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
  serial: number | null;
};

export type ApiMe = {
  employeeId: string; companyId: string; name: string; position: string; department: string;
  email: string | null; start_date: string | null;
  schedule: { in: string; out: string };
  code: string | null; codeImageUrl: string | null;
  today: { check_in: string | null; check_out: string | null; status: string } | null;
};

export type ApiMePayslip = {
  period: string; base_salary: number; earnings: number; deductions: number;
  net: number; currency: string; created_at: string;
  detail: { metrics: Record<string, number>; lines: Array<{ name: string; type: string; basis: string; amount: number; note?: string }> } | null;
};

export type ApiMeAttendance = {
  date: string; check_in: string | null; check_out: string | null;
  status: string; method: string | null;
};

export type ApiMeLeave = {
  requestId: string; type: string; start_date: string; end_date: string;
  reason: string | null; status: string; notes: string | null; created_at: string;
};

export type ApiEmployee = {
  employeeId: string; name: string; email: string | null;
  position: string | null; department: string | null;
  start_date: string | null; status: string;
  schedule: { in: string | null; out: string | null };
  barcode: string | null;
  has_pin?: boolean;
  base_salary?: number;
};

export type EmployeeInput = {
  name?: string; email?: string | null; position?: string | null;
  department?: string | null; start_date?: string | null; status?: string;
  schedule_in?: string; schedule_out?: string;
  password?: string;  // PIN/password login app karyawan
  base_salary?: number;  // gaji pokok (payroll)
};

export type SalaryComponent = { id: string; name: string; type: "earning" | "deduction"; basis: string; value: number };
export type PayrollRule = { id: string; name: string; metric: string; op: string; threshold: number; action: "bonus" | "deduction"; amount: number; active: boolean };
export type PayrollRun = { runId: string; period: string; created_at: string; count: number; totalNet: number };
export type ExchangeRate = { id: string; currency: string; rate: number; base?: string; date: string };
export type Payslip = {
  id: string; employeeId: string; name: string; period: string;
  base_salary: number; earnings: number; deductions: number; net: number;
  currency?: string;
  detail: { metrics: Record<string, number>; lines: Array<{ name: string; type: string; basis: string; amount: number; note?: string }> } | null;
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

export type AppRelease = { versionCode: number; versionName?: string; url: string };
export type AppManifest = Record<string, AppRelease>;

export const api = {
  base: BASE,

  // Manifest versi APK (OTA self-host di EC2). Soft: null bila gagal/ tak ada.
  appManifest: (): Promise<AppManifest | null> =>
    fetch(`${BASE}/downloads/version.json`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null),

  // Auth sistem kontrol
  controlLogin: (email: string, password: string) =>
    req<{ token: string; expires_in: number }>("/api/control/login", {
      method: "POST", body: { email, password },
    }),
  controlLogout: (token: string) =>
    req("/api/control/logout", { method: "POST", token }),
  controlRegister: (body: { name: string; email: string; password: string; company_name: string }) =>
    req<{ adminId: string; companyId: string }>("/api/control/register", { method: "POST", body }),

  // Dashboard ringkasan agregat (server-side) — KPI hari ini + tren 7 hari + dll.
  dashboard: (token: string) =>
    req<ApiDashboard>("/api/dashboard", { token }),

  // Dashboard admin (butuh token)
  attendance: (token: string, date?: string) =>
    req<ApiAttendanceRow[]>(`/api/attendance${date ? `?date=${date}` : ""}`, { token }),
  attendanceRecap: (token: string, period?: string) =>
    req<{ period: string; employees: Array<{ employeeId: string; name: string; position: string | null; department: string | null; schedule_in: string | null; schedule_out: string | null; days_worked: number; late_days: number; late_minutes: number; overtime_hours: number; absent_days: number; leave_days: number }> }>(`/api/attendance/recap${period ? `?period=${period}` : ""}`, { token }),
  leaves: (token: string) =>
    req<ApiLeaveRow[]>("/api/leaves/requests", { token }),
  approveLeave: (token: string, id: string, approved: boolean, notes?: string) =>
    req(`/api/leaves/${id}/approve`, { method: "POST", token, body: { approved, notes } }),
  deleteLeave: (token: string, id: string) => req(`/api/leaves/${id}`, { method: "DELETE", token }),
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
  updateLocation: (token: string, id: string, body: LocationInput) =>
    req<ApiLocation>(`/api/locations/${id}`, { method: "PUT", token, body }),
  deleteLocation: (token: string, id: string) =>
    req(`/api/locations/${id}`, { method: "DELETE", token }),
  deleteLocationCode: (token: string, locationId: string, codeId: string) =>
    req(`/api/locations/${locationId}/codes/${codeId}`, { method: "DELETE", token }),

  // Shift kerja
  shifts: (token: string) => req<Array<{ shiftId: string; name: string; start: string; end: string }>>("/api/shifts", { token }),
  createShift: (token: string, body: { name: string; start: string; end: string }) =>
    req<{ shiftId: string }>("/api/shifts", { method: "POST", token, body }),
  updateShift: (token: string, id: string, body: { name?: string; start?: string; end?: string }) =>
    req(`/api/shifts/${id}`, { method: "PUT", token, body }),
  deleteShift: (token: string, id: string) => req(`/api/shifts/${id}`, { method: "DELETE", token }),

  // Perangkat terdaftar
  devices: (token: string) => req<Array<{ id: string; employeeId: string; deviceId: string; label: string | null; created_at: string }>>("/api/devices", { token }),
  createDevice: (token: string, body: { employeeId: string; deviceId: string; label?: string }) =>
    req<{ id: string }>("/api/devices", { method: "POST", token, body }),
  updateDevice: (token: string, id: string, body: { label?: string | null }) =>
    req(`/api/devices/${id}`, { method: "PUT", token, body }),
  deleteDevice: (token: string, id: string) => req(`/api/devices/${id}`, { method: "DELETE", token }),

  // Profil & pengaturan perusahaan
  company: (token: string) => req<{ companyId: string; name: string; address: string | null; contact_email: string | null; industry: string | null; logo_url: string | null; base_currency?: string; work_hours: { start: string; end: string } }>("/api/company", { token }),
  updateCompany: (token: string, body: Record<string, unknown>) =>
    req("/api/company", { method: "PUT", token, body }),
  companySettings: (token: string) => req<{ timezone: string; attendance_mode: string; language: string; base_currency?: string }>("/api/company/settings", { token }),
  updateCompanySettings: (token: string, body: { timezone?: string; attendance_mode?: string; language?: string; base_currency?: string }) =>
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

  // Payroll (gaji)
  salaryComponents: (token: string) => req<SalaryComponent[]>("/api/salary-components", { token }),
  createSalaryComponent: (token: string, body: { name: string; type: string; basis: string; value: number }) =>
    req<{ id: string }>("/api/salary-components", { method: "POST", token, body }),
  updateSalaryComponent: (token: string, id: string, body: { name?: string; type?: string; basis?: string; value?: number }) =>
    req(`/api/salary-components/${id}`, { method: "PUT", token, body }),
  deleteSalaryComponent: (token: string, id: string) =>
    req(`/api/salary-components/${id}`, { method: "DELETE", token }),
  payrollRules: (token: string) => req<PayrollRule[]>("/api/payroll-rules", { token }),
  createPayrollRule: (token: string, body: { name: string; metric: string; op: string; threshold: number; action: string; amount: number }) =>
    req<{ id: string }>("/api/payroll-rules", { method: "POST", token, body }),
  updatePayrollRule: (token: string, id: string, body: { name?: string; metric?: string; op?: string; threshold?: number; action?: string; amount?: number; active?: boolean }) =>
    req(`/api/payroll-rules/${id}`, { method: "PUT", token, body }),
  deletePayrollRule: (token: string, id: string) =>
    req(`/api/payroll-rules/${id}`, { method: "DELETE", token }),
  runPayroll: (token: string, period: string) =>
    req<PayrollRun & { runId: string }>("/api/payroll/run", { method: "POST", token, body: { period } }),
  payrollRuns: (token: string) => req<PayrollRun[]>("/api/payroll/runs", { token }),
  runPayslips: (token: string, runId: string) => req<Payslip[]>(`/api/payroll/runs/${runId}/payslips`, { token }),
  deletePayrollRun: (token: string, runId: string) => req(`/api/payroll/runs/${runId}`, { method: "DELETE", token }),

  // Kurs / multi-currency
  exchangeRates: (token: string) => req<ExchangeRate[]>("/api/exchange-rates", { token }),
  createExchangeRate: (token: string, body: { currency: string; rate: number; date?: string }) =>
    req<{ id: string }>("/api/exchange-rates", { method: "POST", token, body }),
  updateExchangeRate: (token: string, id: string, body: { currency?: string; rate?: number; date?: string }) =>
    req(`/api/exchange-rates/${id}`, { method: "PUT", token, body }),
  deleteExchangeRate: (token: string, id: string) =>
    req(`/api/exchange-rates/${id}`, { method: "DELETE", token }),

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
  // Riwayat presensi & izin/cuti milik karyawan sendiri (self-service).
  meAttendance: (token: string, q?: { start?: string; end?: string }) =>
    req<ApiMeAttendance[]>(
      `/api/me/attendance${q && (q.start || q.end) ? `?${new URLSearchParams(q as Record<string, string>)}` : ""}`,
      { token }),
  meLeaves: (token: string) => req<ApiMeLeave[]>("/api/me/leave", { token }),
  submitLeave: (token: string, body: { type: string; start_date: string; end_date: string; reason?: string }) =>
    req<{ requestId: string; status: string }>("/api/me/leave", { method: "POST", token, body }),
  mePayslips: (token: string) => req<ApiMePayslip[]>("/api/me/payslips", { token }),

  // Publik (kiosk / app karyawan). MULTI-TENANT: WAJIB di-scope ke lokasi/perusahaan
  // (backend menolak tanpa scope). Display kiosk mengirim VITE_LOCATION_ID/COMPANY_ID;
  // app karyawan & panel kontrol mengirim companyId miliknya.
  publicLocation: (params?: { location?: string; company?: string }) => {
    const q = new URLSearchParams();
    if (params?.location) q.set("location", params.location);
    if (params?.company) q.set("company", params.company);
    const qs = q.toString();
    return req<ApiPublicLocation>(`/api/public/location${qs ? `?${qs}` : ""}`);
  },
};
