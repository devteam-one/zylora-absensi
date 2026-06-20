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

# Vite mengekspos VITE_* dari file .env → suntik URL API lewat .env.production.local.
cleanup() { rm -f .env.production.local; }
trap cleanup EXIT
printf 'VITE_API_URL=%s\n' "$API_URL" > .env.production.local

echo "→ Build KARYAWAN  → dist-employee/  (API: $API_URL)"
VITE_ROLE=employee npx vite build --outDir dist-employee --emptyOutDir

echo "→ Build SISTEM KONTROL → dist-control/  (API: $API_URL)"
VITE_ROLE=control npx vite build --outDir dist-control --emptyOutDir

echo "→ Build TAMPILAN BARCODE → dist-display/  (API: $API_URL)"
VITE_ROLE=display npx vite build --outDir dist-display --emptyOutDir

echo "✅ Selesai: dist-employee/ , dist-control/ , dist-display/ siap di-host (3 situs statis)."
