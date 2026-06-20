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
cd android && ./gradlew assembleDebug
# APK: android-app/android/app/build/outputs/apk/debug/app-debug.apk
```

## Rilis (Play Store / signed)

APK dari workflow ini **debug** (untuk uji/sideload). Untuk rilis:
- Buat keystore: `keytool -genkey -v -keystore zylora.keystore -alias zylora -keyalg RSA -keysize 2048 -validity 10000`
- Simpan keystore + password sebagai **GitHub Secrets**, tambahkan signing config di
  `android-app/android/app/build.gradle`, dan ganti `assembleDebug` → `assembleRelease`
  (atau `bundleRelease` untuk `.aab` Play Store).
- `appId` = `id.zylora.absensi` (ubah di `capacitor.config.json` bila perlu).

## Catatan

- Build pertama bisa minta penyesuaian versi (Capacitor 6 ↔ Android SDK/Gradle). Ini scaffold; iterasi di Actions log bila ada error.
- Untuk APK yang juga jalan **offline penuh**, aset sudah di-bundle (WebView lokal) + service worker PWA; hanya panggilan API yang butuh jaringan.
