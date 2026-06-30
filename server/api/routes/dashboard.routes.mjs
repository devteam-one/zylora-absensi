// ─── Dashboard admin (ringkasan agregat) ─────────────────────────────────────
// Satu endpoint ber-agregasi server-side untuk halaman Dashboard panel kontrol:
// KPI hari ini, tren 7 hari, cuti tertunda, sebaran headcount, ringkasan bulan,
// dan aktivitas audit terakhir. Dihitung di SQL (efisien) — bukan dengan
// mengirim seluruh baris mentah ke klien.
import { json } from "../lib/http.mjs";
import { get, all } from "../lib/db.mjs";
import { requireControl } from "../lib/middleware.mjs";
import { companyTz, todayStrTz } from "../lib/attendance-core.mjs";

// Geser tanggal "YYYY-MM-DD" sebanyak `delta` hari (UTC, bebas-DST untuk string tanggal).
function addDays(ymd, delta) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

export function register(router) {
  router.get("/api/dashboard", requireControl, (ctx) => {
    const cid = ctx.auth.companyId;
    const today = todayStrTz(companyTz(cid));

    // Jendela 7 hari (inklusif), string tanggal di zona perusahaan.
    const days = [];
    for (let i = 6; i >= 0; i--) days.push(addDays(today, -i));
    const start = days[0];

    const totalEmp = get("SELECT COUNT(*) AS n FROM employees WHERE company_id = ? AND status = 'active'", cid).n;

    // KPI hari ini — SEMUA bucket di-scope ke karyawan AKTIF (denominator = totalEmp)
    // agar konsisten: present+late+onLeave+absent mempartisi karyawan aktif tanpa
    // hitung-ganda & tanpa rate >100%.
    // present/late: hanya absensi karyawan aktif hari ini.
    const todayRows = all(
      `SELECT a.status, COUNT(*) AS n FROM attendance a
       JOIN employees e ON e.id = a.employee_id
       WHERE a.company_id = ? AND a.date = ? AND e.status = 'active' GROUP BY a.status`,
      cid, today,
    );
    const cnt = (s) => todayRows.find((r) => r.status === s)?.n || 0;
    const present = cnt("hadir");
    const late = cnt("terlambat");
    // on-leave: karyawan AKTIF dengan cuti disetujui yang mencakup hari ini DAN belum
    // tercatat absen hari ini (cegah hitung-ganda jika ia tetap check-in). DISTINCT
    // agar satu orang dengan beberapa pengajuan tak dihitung berkali-kali.
    const onLeave = get(
      `SELECT COUNT(DISTINCT lr.employee_id) AS n FROM leave_requests lr
       JOIN employees e ON e.id = lr.employee_id
       WHERE lr.company_id = ? AND e.status = 'active' AND lr.status = 'approved'
         AND lr.start_date <= ? AND lr.end_date >= ?
         AND lr.employee_id NOT IN (SELECT employee_id FROM attendance WHERE company_id = ? AND date = ?)`,
      cid, today, today, cid, today,
    ).n;
    const absent = Math.max(0, totalEmp - present - late - onLeave);
    const attendanceRate = totalEmp ? Math.round(((present + late) / totalEmp) * 100) : 0;

    // Tren 7 hari: jumlah check-in (hadir+terlambat) & telat per hari.
    const trendRows = all(
      `SELECT date,
         SUM(CASE WHEN status IN ('hadir','terlambat') THEN 1 ELSE 0 END) AS checked_in,
         SUM(CASE WHEN status = 'terlambat' THEN 1 ELSE 0 END) AS late
       FROM attendance WHERE company_id = ? AND date >= ? AND date <= ? GROUP BY date`,
      cid, start, today,
    );
    const trend = days.map((d) => {
      const r = trendRows.find((x) => x.date === d);
      return { date: d, checkedIn: r?.checked_in || 0, late: r?.late || 0 };
    });

    const pendingLeaves = get("SELECT COUNT(*) AS n FROM leave_requests WHERE company_id = ? AND status = 'pending'", cid).n;
    const locationCount = get("SELECT COUNT(*) AS n FROM locations WHERE company_id = ?", cid).n;

    const byDept = all(
      "SELECT COALESCE(NULLIF(department, ''), '—') AS dept, COUNT(*) AS n FROM employees WHERE company_id = ? AND status = 'active' GROUP BY dept ORDER BY n DESC LIMIT 6",
      cid,
    ).map((d) => ({ department: d.dept, count: d.n }));

    // Ringkasan bulan berjalan (insiden telat) dari papan presensi.
    const month = today.slice(0, 7);
    const monthAgg = get(
      "SELECT SUM(CASE WHEN status = 'terlambat' THEN 1 ELSE 0 END) AS late_incidents, COUNT(*) AS records FROM attendance WHERE company_id = ? AND substr(date,1,7) = ?",
      cid, month,
    );

    const recentActivity = all(
      "SELECT action, detail, created_at FROM audit_logs WHERE company_id = ? ORDER BY created_at DESC LIMIT 6",
      cid,
    ).map((r) => ({ action: r.action, detail: r.detail, created_at: r.created_at }));

    json(ctx.res, 200, {
      today: { date: today, present, late, onLeave, absent, total: totalEmp, attendanceRate },
      trend,
      pendingLeaves,
      locationCount,
      headcountByDept: byDept,
      month: { period: month, lateIncidents: monthAgg?.late_incidents || 0, records: monthAgg?.records || 0 },
      recentActivity,
    });
  });
}
