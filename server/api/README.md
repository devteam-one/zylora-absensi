# Zylora API — Backend Absensi QR/Barcode

REST API **sungguhan** untuk sistem absensi "Zylora": autentikasi JWT, RBAC,
persistensi SQLite, validasi lokasi (LBS/GPS), dan QR statis/dinamis/personal.
Ini menggantikan mock React state di prototipe `src/app/App.tsx` — sistem kontrol dan app
karyawan kini bicara ke **satu backend yang sama** sebagai sumber kebenaran.

## Kenapa zero-dependency?

Dibangun di atas `node:http` + `node:sqlite` + `node:crypto` bawaan Node — **tanpa**
Express/bcrypt/jsonwebtoken/driver DB. Alasannya sama dengan `server/sync-server.mjs`:
proyek mendokumentasikan blokir jaringan untuk `npm install` (lihat
`.design-sync/NOTES.md`), jadi backend tanpa dependency dijamin langsung jalan.
Butuh Node ≥ 22 (`node:sqlite`); diuji di Node 24.

## Menjalankan

```bash
npm run api          # → http://127.0.0.2:5181  (otomatis seed data demo bila DB kosong)

# Override:
ZYLORA_PORT=5181 ZYLORA_HOST=127.0.0.2 ZYLORA_SECRET="rahasia-produksi" npm run api
```

Database tersimpan di `server/api/data/zylora.db` (gitignored). **Hapus file itu untuk
reset** ke data seed.

Login demo hasil seed: **`kontrol@nusantara.co.id` / `kontrol1234`**.

## Autentikasi (per-peran)

Dua peran terpisah, JWT HS256, sesi disimpan di tabel `sessions` (logout = revoke):

- **Sistem Kontrol** — `POST /api/control/login` (email+password) → token peran `control`, TTL 8 jam.
  Hanya token sistem kontrol yang bisa mengakses endpoint dashboard (`requireControl`).
- **Karyawan** — `POST /api/employee/login` (employeeId+PIN) → token peran `employee`,
  TTL 12 jam. Hanya bisa mengakses `/api/me/*` (`requireEmployee`).

RBAC ditegakkan: token karyawan ditolak `403` di endpoint kontrol, dan sebaliknya.
Saat check-in via app karyawan, identitas diambil dari token — kode personal tak
perlu dikirim dari klien. Password/PIN di-hash `scrypt` (ber-salt). Set
`ZYLORA_SECRET` di produksi.

Login demo: sistem kontrol `kontrol@nusantara.co.id` / `kontrol1234` · karyawan `EMP001–EMP008` / PIN `123456`.

## Daftar Endpoint

| Grup | Endpoint |
|------|----------|
| **Auth sistem kontrol** | `POST /api/control/register`, `/api/control/login`, `/api/control/logout`, `/api/company/register` |
| **Auth karyawan** | `POST /api/employee/login`, `/api/employee/logout`; `GET /api/me`; `POST /api/me/checkin`, `/api/me/checkout` |
| **Perusahaan** | `GET/PUT /api/company`, `POST /api/company/logo`, `GET/PUT /api/company/settings` |
| **Karyawan** | `POST/GET /api/employees`, `GET/PUT/DELETE /api/employees/:id`, `GET /api/employees/:id/attendance` |
| **Kode personal** | `POST/GET /api/employees/:id/code`, `POST /api/employees/:id/code/reset` |
| **Lokasi & QR** | `POST/GET /api/locations`, `POST /api/locations/:id/codes` (statis), `/codes/dynamic`, `GET/PUT /api/locations/:id/codes/:codeId`, `POST .../refresh` |
| **Konfigurasi** | `GET/POST /api/shifts`, `PUT /api/shifts/:id`, `GET/POST /api/leaves/requests`, `POST /api/leaves/:id/approve`, `GET/POST /api/devices`, `GET /api/logs` |
| **Presensi (app karyawan)** | `POST /api/attendance/checkin`, `/checkout`, `GET /api/attendance?date=` |

### Alur scan presensi (inti sistem)

`POST /api/attendance/checkin` dipanggil app karyawan, body:

```json
{ "employee_code": "ZYL-EMP-EMP001-...", "location_token": "ZYL-DYN-loc_jkt-...", "lat": -6.2088, "lng": 106.8456 }
```

Server memverifikasi berurutan: **identitas** (kode personal ber-tanda-tangan) →
**keabsahan QR lokasi** (statis exact-match / dinamis dalam jendela waktu) →
**posisi GPS** dalam radius lokasi (haversine). Status `hadir`/`terlambat`
ditentukan dari jadwal karyawan. Double check-in ditolak `409`.

## Struktur

```
server/api/
  server.mjs            entry: http server + mount router + seed
  routes/
    index.mjs           agregator
    auth|company|employees|locations|config|attendance.routes.mjs
  lib/
    db.mjs              skema + helper SQLite (node:sqlite)
    security.mjs        scrypt password, JWT HS256, id generator
    qr.mjs              token QR statis/dinamis/personal + URL gambar
    http.mjs            router, body reader, helper respons
    middleware.mjs      requireAuth, requireRole (RBAC), rateLimit, audit
    validate.mjs        validasi input
  seed.mjs              data demo (mirror prototipe)
  data/zylora.db        DB runtime (gitignored)
```

## Catatan keamanan (lihat §7 spec)

- ✅ JWT + revoke sesi, scrypt password hashing, RBAC (`requireRole`).
- ✅ Rate-limit pada login/register (fixed-window in-memory).
- ✅ Validasi LBS/GPS terhadap radius lokasi.
- ✅ QR dinamis berputar per interval; audit log untuk aksi operator sistem kontrol.
- ⚠️ **Produksi:** taruh di belakang HTTPS (TLS terminator), set `ZYLORA_SECRET`,
  ganti rate-limit ke store bersama (Redis) bila multi-instance, dan
  pertimbangkan migrasi ke PostgreSQL bila skala menuntut (skema SQL sudah relasional).
