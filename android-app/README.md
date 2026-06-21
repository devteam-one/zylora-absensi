# Zylora — APK Android (Capacitor + CI)

Membungkus frontend Zylora (yang sudah jadi **PWA**) menjadi **APK Android**.
Mesin lokal ini tidak punya Android SDK + Gradle modern + akses npm, jadi build APK
dijalankan di **GitHub Actions** (lihat `.github/workflows/android-apk.yml`).

## Alur

```
frontend (Vite/React, PWA)  →  build web (dist-employee)  →  Capacitor (WebView)  →  APK
                                       ↑ VITE_API_URL=https://api-anda             ↓
                                  panggil REST API Zylora di EC2 (HTTPS)      sideload / Play Store
```

APK membungkus UI dan memanggil **API Zylora di EC2** lewat HTTPS — jadi backend
(EC2 + domain + TLS) tetap prasyarat agar app berfungsi.

## Cara build (CI)

Prasyarat: proyek ada di repo GitHub (saat ini belum git — `git init`, commit, push dulu).

1. GitHub → tab **Actions** → **Build Android APK (Zylora)** → **Run workflow**.
2. Isi input:
   - `api_url` = URL API produksi, mis. `https://api.domain-anda.com`
   - `role` = `employee` (app karyawan) atau `control`
3. Selesai → unduh artifact **`zylora-employee-apk`** (file `.apk`).
4. Sideload ke Android (aktifkan "Install unknown apps"), atau lanjut ke signing rilis.

## Build lokal (alternatif, butuh toolchain)

Di mesin ber-Android SDK 34+, JDK 21, Node 22:
```bash
# dari root proyek
VITE_API_URL=https://api-anda VITE_ROLE=employee pnpm exec vite build --outDir dist-employee
cd android-app && mkdir -p www && cp -r ../dist-employee/. www/
npm install && npx cap add android && npx cap sync android
node inject-permissions.mjs   # izin kamera + lokasi (scan QR & GPS)
node inject-signing.mjs       # konfigurasi release signing (debug bila tanpa keystore)
cd android && ./gradlew assembleRelease
# APK: android-app/android/app/build/outputs/apk/release/app-release.apk (debug-signed)
```

## Rilis (Play Store / signed)

Workflow CI + `inject-signing.mjs` sudah menangani signing **otomatis**: bila GitHub
Secrets keystore di-set, build jadi **release-signed** (APK + `.aab` Play Store);
bila tidak, **debug-signed** (cukup untuk sideload/uji).

Langkah aktifkan release signing:
1. Buat keystore (sekali, simpan aman — JANGAN commit):
   ```bash
   keytool -genkeypair -v -keystore zylora.keystore -alias zylora \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Encode base64: `base64 -w0 zylora.keystore` (copy hasilnya).
3. GitHub repo → Settings → Secrets and variables → Actions → tambah 4 secret:
   - `ANDROID_KEYSTORE_BASE64` = hasil base64 di atas
   - `ANDROID_KEYSTORE_PASSWORD` = password keystore
   - `ANDROID_KEY_ALIAS` = `zylora`
   - `ANDROID_KEY_PASSWORD` = password kunci
4. Jalankan workflow **Build Android APK** → artefak `zylora-<role>-apk` berisi
   `app-release.apk` (release-signed) + `app-release.aab` (untuk upload Play Store).

Catatan: setelah pindah dari debug ke release signing, pengguna yang sudah memasang
versi debug harus **uninstall dulu** (signature beda). `appId` =
`id.zylora.absensi` (ubah di `capacitor.config.json` bila perlu).

## Catatan

- Build pertama bisa minta penyesuaian versi (Capacitor 6 ↔ Android SDK/Gradle). Ini scaffold; iterasi di Actions log bila ada error.
- Untuk APK yang juga jalan **offline penuh**, aset sudah di-bundle (WebView lokal) + service worker PWA; hanya panggilan API yang butuh jaringan.
