# Zylora — Catatan Lanjutan (Runbook)

> Status per **2026-06-24**. Commit acuan: **`cb15fc0`** (di `main`, sudah di-push).
> Dokumen ini = titik lanjut kerja: apa yang sudah live, apa yang tertunda, dan
> **langkah pasti** menyelesaikannya. **Tidak memuat nilai kredensial** — lihat
> bagian Keamanan.

---

## 1. Ringkasan status

| Bagian | Status |
|---|---|
| Kode sumber (`cb15fc0`) | ✅ Ter-commit & **push ke `main`** (memicu CI APK/desktop/smoke) |
| **Backend produksi (EC2)** | ✅ **LIVE di `cb15fc0`** — semua fitur API baru jalan |
| Frontend produksi (3 sub-domain) | ⚠️ **Masih versi deploy sebelumnya** — perlu rebuild dari `cb15fc0` |
| Skema Neon Postgres (`absen`) | ✅ 17 tabel dibuat (via `psql`) — lihat `deploy/neon-schema.sql` |
| Adapter Postgres (`db-pg.mjs`) | ✅ Ditulis (dorman; aktif hanya bila `ZYLORA_DATABASE_URL` di-set) |
| Migrasi handler → async Postgres | ⛔ **Belum** (rewrite besar; lihat §5) |
| `node_modules` lokal | ⛔ **Kosong** (rusak saat install Neon) → perlu `pnpm install` di terminal |

**Inti:** backend sudah penuh; tinggal **rebuild+deploy frontend** dan **(opsional) migrasi Postgres**.

---

## 2. Yang selesai di sesi ini (sudah di `cb15fc0`)

- **App karyawan** jadi 5 tab: Absen · Riwayat · **Gaji** (slip sendiri) · Izin ·
  **Profil** (email, tgl masuk, kode personal). Perbaikan bug: label sukses
  check-in/out, jam pulang, `StatusBadge` "alpa". **"Ingat saya"** di login
  karyawan & kontrol. Registrasi Sistem Kontrol diperjelas (toggle Masuk/Daftar).
- **Multi-currency** (tidak dipaku Rupiah): `companies.base_currency` +
  `payslips.currency`; `fmtMoney()` dinamis; mata uang dipilih per-perusahaan.
- **CRUD backend lengkap + validasi**: update/delete untuk lokasi, kode QR, shift,
  perangkat, izin, komponen gaji, aturan, kurs, run payroll.
- **Self-service karyawan**: `/api/me/attendance`, `/api/me/leave`, `/api/me/payslips`.
- **State refresh seragam**: hook `usePolledData` (poll seragam + jeda saat
  form/modal) menggantikan pola fetch terduplikasi tiap tab.
- **Buang kode mati**: `server/sync-server.mjs` + skrip relay 2-port.
- Pengerasan produksi sebelumnya (commit `2f7a8d1`): rahasia wajib, timezone
  per-perusahaan, backup DB, CORS configurable, smoke test.

Verifikasi: smoke test **6/6**, build 3 role, screenshot tiap fitur.

---

## 3. Akses produksi (EC2)

- Host: `13.218.74.178` · user `ubuntu` · key `~/.ssh/id_ed25519_server`
- Service: `zylora-api` (systemd) → `127.0.0.1:5181`, di-front nginx.
- Sub-domain (nginx + TLS Certbot, **jangan diutak-atik tanpa perlu**):
  - `api.13-218-74-178.sslip.io` → API (`:5181`)
  - `app.13-218-74-178.sslip.io` → frontend **karyawan** → webroot `/opt/zylora/web`
  - `kontrol.13-218-74-178.sslip.io` → **kontrol** → `/opt/zylora/web-kontrol`
  - `qr.13-218-74-178.sslip.io` → **display** → `/opt/zylora/web-qr`
- Aplikasi lain di server yang sama: `console-bahasa` → **JANGAN disentuh**.
- Env: `/etc/zylora.env` (mode 600) berisi `ZYLORA_SECRET`, `NODE_ENV=production`,
  `ZYLORA_TZ`, dll. **Rahasia di-pakai-ulang saat deploy** (jangan rotasi tak sengaja
  → akan meng-invalidate semua sesi & token QR/kode karyawan).

---

## 4. TERTUNDA — Selesaikan deploy frontend

`node_modules` lokal kosong; package manager hang di sandbox tool (curl jalan, tapi
npm/pnpm tidak — egress filter). **Pulihkan dari terminal Anda dulu:**

```bash
# 1) Di terminal NORMAL Anda (jaringan jalan):
cd "/home/hemo/WEBSITE/Absensi Digital dengan QR-Code"
pnpm install            # pulihkan node_modules (gagal di sandbox tool, jalan di terminal Anda)
```

Lalu rebuild + deploy 3 frontend (boleh dari terminal, atau minta agent lanjут):

```bash
# 2) Build 3 frontend menunjuk API produksi
VITE_API_URL=https://api.13-218-74-178.sslip.io ./deploy/build-frontends.sh
# → dist-employee/ dist-control/ dist-display/   (versi cb15fc0)

# 3) rsync ke webroot (via sudo di remote)
SSHK="ssh -i ~/.ssh/id_ed25519_server -o BatchMode=yes"
rsync -az --delete -e "$SSHK" --rsync-path="sudo rsync" dist-employee/ ubuntu@13.218.74.178:/opt/zylora/web/
rsync -az --delete -e "$SSHK" --rsync-path="sudo rsync" dist-control/  ubuntu@13.218.74.178:/opt/zylora/web-kontrol/
rsync -az --delete -e "$SSHK" --rsync-path="sudo rsync" dist-display/  ubuntu@13.218.74.178:/opt/zylora/web-qr/

# 4) Verifikasi: HTTP 200 + sw.js versi baru di tiap sub-domain
for h in app kontrol qr; do
  echo "$h: $(curl -s -o /dev/null -w '%{http_code}' https://$h.13-218-74-178.sslip.io/)"
  curl -s https://$h.13-218-74-178.sslip.io/sw.js | grep -o 'VERSION = "[^"]*"' | head -1
done
```

> Catatan: jika `npx` hang (registry), jalankan vite langsung:
> `node_modules/.bin/vite build ...` (hindari `npx`).
> Backend **tidak** perlu di-deploy ulang — sudah `cb15fc0`.

---

## 5. TERTUNDA — Migrasi backend ke Neon Postgres (opsional, besar)

### Sudah disiapkan
- **Skema** ada di Neon DB **`absen`** (17 tabel) — `deploy/neon-schema.sql`.
  Reserved word di-quote: `shifts."end"`, `location_codes."interval"`. `REAL`→`double precision`.
- **Adapter** `server/api/lib/db-pg.mjs`: antarmuka `get/all/run/tx` **async**,
  konversi placeholder `?`→`$n`, transaksi atomik via `AsyncLocalStorage`.
  Dipakai bila env **`ZYLORA_DATABASE_URL`** di-set; selain itu tetap SQLite (`db.mjs`).

### Yang masih harus dikerjakan (rewrite besar)
1. **Buat switch** di `server/api/lib/db.mjs` (atau modul `db/index.mjs`) yang
   memilih `db-pg.mjs` vs SQLite berdasar `ZYLORA_DATABASE_URL`. Re-export
   `get/all/run/tx` (+ `cleanupExpired`, `tx`).
2. **Konversi SEMUA handler & lib ke `async/await`** pada setiap pemanggilan
   `get/all/run/tx`:
   - `routes/*.routes.mjs` (auth, company, employees, locations, config,
     attendance, public, employee, payroll) — jadikan handler `async`, `await`
     setiap query. Router (`http.mjs`) sudah `await fn(ctx)`, jadi aman.
   - `lib/attendance-core.mjs`, `lib/payroll-core.mjs`, `lib/middleware.mjs`
     (`requireAuth`/`audit`), `server.mjs` (`housekeeping`).
   - **`tx(fn)`**: callback jadi `async` & **`await` tiap query** di dalamnya
     (callsite: register perusahaan+admin, run payroll).
   - Catatan: `await` pada nilai sinkron (SQLite) tetap aman → **dual-mode**.
3. **Driver di deploy**: backend Postgres butuh `@neondatabase/serverless`
   (sudah dicatat di `package.json`). Deploy SQLite saat ini **tidak** `npm install`;
   untuk mode Postgres, tambahkan `npm i` di `deploy/setup-remote.sh` + set
   `ZYLORA_DATABASE_URL` di `/etc/zylora.env`.
4. **Uji**: jalankan smoke test (`server/api/test/`) terhadap Postgres
   (`ZYLORA_DATABASE_URL=...absen...`). Tidak bisa diuji di sandbox tool (driver
   443 diblokir) → uji di terminal Anda / saat deploy EC2.
5. **Migrasi data** (bila perlu): data SQLite produksi kecil/awal-bersih. Bila ada
   data, ekspor per-tabel → `COPY`/INSERT ke Postgres. Produksi mulai bersih → bisa
   diabaikan.

### Koneksi (untuk env, BUKAN ditulis ke repo)
- Database app: **`absen`** (bukan `neondb`/`Neon Auth`).
- Bentuk: `postgresql://<user>:<password>@ep-red-wildflower-ai42o4rl-pooler.c-4.us-east-1.aws.neon.tech/absen?sslmode=require`
- `psql` ke host ini **jalan** (port 5432); driver serverless Node butuh 443
  (jalan di EC2/terminal Anda, diblokir di sandbox tool).

---

## 6. Keamanan — WAJIB

Kredensial Neon **tampil di chat** (password DB `npg_…` & API key `napi_…`).
**Rotasi keduanya** di dashboard Neon, lalu perbarui `ZYLORA_DATABASE_URL`
(saat mode Postgres dipakai). Jangan commit nilai rahasia ke repo —
gunakan env (`/etc/zylora.env`, `.env` lokal yang gitignored).

---

## 7. Referензi cepat

- Build per-role: `deploy/build-frontends.sh` (butuh `VITE_API_URL`).
- Deploy backend: `deploy/deploy.sh` (override `ZYLORA_SSH_KEY`,
  `ZYLORA_EC2_HOST=13.218.74.178`, `ZYLORA_SECRET=<pakai ulang dari /etc/zylora.env>`).
- Smoke test: `pnpm test:api` (atau `node --test server/api/test/*.mjs`).
- Skema Postgres: `deploy/neon-schema.sql`. Adapter: `server/api/lib/db-pg.mjs`.
- Versi/identitas: `version.json` (root). Backend baca `/api/version`.
