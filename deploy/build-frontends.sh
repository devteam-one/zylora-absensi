#!/usr/bin/env bash
# Build 2 frontend untuk PRODUKSI, masing-masing menunjuk ke API di EC2.
#   VITE_API_URL=https://api.domain-anda.com ./deploy/build-frontends.sh
#
# Hasil: dist-employee/ (app karyawan) & dist-control/ (sistem kontrol) — dua
# situs statis terpisah, host di domain/sub-domain berbeda (nginx/S3/Pages).
set -euo pipefail

API_URL="${VITE_API_URL:?Set VITE_API_URL ke URL API EC2, mis: https://api.domain-anda.com}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

# Kode versi monoton untuk cek update OTA (UpdateBanner). Default: jumlah commit
# (naik tiap rilis); override via VITE_VERSION_CODE. Tanpa ini, web build = "0"
# dan banner update tak pernah aktif.
export VITE_VERSION_CODE="${VITE_VERSION_CODE:-$(git rev-list --count HEAD 2>/dev/null || echo 1)}"
echo "→ VITE_VERSION_CODE=$VITE_VERSION_CODE  API=$API_URL"

# Vite mengekspos VITE_* dari file .env → suntik URL API lewat .env.production.local.
cleanup() { rm -f .env.production.local; }
trap cleanup EXIT
printf 'VITE_API_URL=%s\nVITE_VERSION_CODE=%s\n' "$API_URL" "$VITE_VERSION_CODE" > .env.production.local

echo "→ Build KARYAWAN  → dist-employee/  (API: $API_URL)"
VITE_ROLE=employee npx vite build --outDir dist-employee --emptyOutDir

echo "→ Build SISTEM KONTROL → dist-control/  (API: $API_URL)"
VITE_ROLE=control npx vite build --outDir dist-control --emptyOutDir

# Display kiosk MULTI-TENANT: harus tahu lokasi/perusahaan yang ditampilkannya
# (endpoint /api/public/location kini menolak tanpa scope). Set VITE_LOCATION_ID
# (disarankan) ATAU VITE_COMPANY_ID untuk deployment ini; tanpa itu kiosk hanya
# menampilkan "Display not configured".
if [ -z "${VITE_LOCATION_ID:-}${VITE_COMPANY_ID:-}" ]; then
  echo "⚠️  VITE_LOCATION_ID/VITE_COMPANY_ID belum di-set → build display TIDAK terkonfigurasi (kiosk menampilkan 'Display not configured'). Set salah satunya untuk kiosk fungsional."
fi
echo "→ Build TAMPILAN BARCODE → dist-display/  (API: $API_URL)"
VITE_ROLE=display VITE_LOCATION_ID="${VITE_LOCATION_ID:-}" VITE_COMPANY_ID="${VITE_COMPANY_ID:-}" \
  npx vite build --outDir dist-display --emptyOutDir

echo "✅ Selesai: dist-employee/ , dist-control/ , dist-display/ siap di-host (3 situs statis)."
