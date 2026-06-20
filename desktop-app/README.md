# Zylora Sistem Kontrol — Installer Desktop (Electron + CI)

Membungkus frontend **Sistem Kontrol** (role `control`) jadi aplikasi desktop
lintas-OS: **Windows `.exe` (NSIS)**, **macOS `.dmg`**, **Linux `.AppImage`/`.deb`**.
Build dijalankan di **GitHub Actions** (matrix per-OS) — mesin lokal tak punya
toolchain Electron + npm.

## Build (CI)
Prasyarat: proyek di repo GitHub.
1. Actions → **Build Desktop Installer — Sistem Kontrol** → Run workflow.
2. Isi `api_url` = URL HTTPS API (mis. `https://api.domain-anda.com`).
3. Unduh artifact per-OS: `zylora-kontrol-windows-latest` (.exe), `...-macos-latest` (.dmg), `...-ubuntu-latest` (.AppImage/.deb).

## Cara kerja
- Web dibangun `VITE_ROLE=control` dengan `--base ./` (aset relatif untuk `file://`).
- `main.js` (Electron) memuat `www/index.html` yang sudah di-bundle; data via REST API.

## Build lokal (alternatif, butuh Node + Electron)
```bash
VITE_ROLE=control VITE_API_URL=https://api-anda pnpm exec vite build --base ./ --outDir desktop-app/www
cd desktop-app && npm install && npx electron-builder
# hasil: desktop-app/dist-installers/
```

## Produksi
- Windows tanpa tanda tangan → SmartScreen memperingatkan. Tambah code-signing
  (`CSC_LINK` + `CSC_KEY_PASSWORD` sebagai GitHub Secrets).
- Panel kontrol saat ini auto-login operator demo (`kontrol@…`). Untuk produksi,
  tambahkan layar login (backend sudah dukung JWT peran `control`).
