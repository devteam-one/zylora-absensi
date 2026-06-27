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
| Dukungan Postgres/Neon | 🗑️ **Dihapus** (2026-06-28) — adapter `db-pg.mjs` tak pernah tersambung & akan korup bila dipakai; SQLite kini satu-satunya backend. Lihat §5. |
| `node_modules` lokal | ⛔ **Kosong** → perlu `pnpm install` di terminal |

**Inti:** backend sudah penuh; tinggal **rebuild+deploy frontend**. (Backend = SQLite zero-dependency.)

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

## 5. Dukungan Postgres/Neon — DIHAPUS (2026-06-28)

Jalur Postgres dibuang karena **tidak pernah aktif** dan menyimpan jebakan: adapter
`server/api/lib/db-pg.mjs` tak pernah disambungkan ke router (semua modul meng-`import`
`db.mjs`/SQLite), antarmukanya **async** padahal seluruh callsite memakai hasilnya
secara sinkron, dan SQL-nya memuat kolom reserved tak ter-quote (`end`/`interval`) yang
ditolak Postgres. Akibatnya `ZYLORA_DATABASE_URL` **tidak berefek** — operator bisa
mengira data masuk ke Neon padahal app tetap menulis ke SQLite lokal (gitignored).

Yang dilakukan:
- **Dihapus**: `server/api/lib/db-pg.mjs`, `deploy/neon-schema.sql`.
- **Guard**: `server.mjs` kini **menolak start** bila `ZYLORA_DATABASE_URL`/`DATABASE_URL`
  di-set (mengubah jebakan senyap → kegagalan keras). SQLite adalah satu-satunya backend.
- Dependensi `@neondatabase/serverless` di `package.json` kini **tak terpakai** dan bisa
  dihapus saat lockfile di-regenerasi berikutnya.

Bila kelak skala menuntut Postgres, mulai dari nol dengan abstraksi DB async sejati
(semua handler/`tx` di-`await`) — bukan menghidupkan adapter lama ini.

---

## 6. Keamanan — WAJIB

Kredensial Neon pernah **tampil di chat** (password DB `npg_…` & API key `napi_…`).
Meski dukungan Postgres sudah dihapus (§5), **tetap rotasi/nonaktifkan keduanya** di
dashboard Neon — kredensial yang pernah bocor harus dianggap terkompromi. Jangan commit
nilai rahasia ke repo — gunakan env (`/etc/zylora.env`, `.env` lokal yang gitignored).

---

## 7. Referензi cepat

- Build per-role: `deploy/build-frontends.sh` (butuh `VITE_API_URL`).
- Deploy backend: `deploy/deploy.sh` (override `ZYLORA_SSH_KEY`,
  `ZYLORA_EC2_HOST=13.218.74.178`, `ZYLORA_SECRET=<pakai ulang dari /etc/zylora.env>`).
- Smoke test: `pnpm test:api` (atau `node --test server/api/test/*.mjs`).
- Versi/identitas: `version.json` (root). Backend baca `/api/version`.
