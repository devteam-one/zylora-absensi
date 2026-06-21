// Sisipkan izin kamera + lokasi ke AndroidManifest hasil `cap add/sync`.
// Tanpa ini, getUserMedia (kamera) & navigator.geolocation TIDAK jalan di WebView
// Capacitor — sehingga scan QR & cek GPS gagal. android/ di-regenerate tiap build,
// jadi skrip ini dijalankan setelah cap sync (lihat CI android-apk.yml & deploy/build).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(__dirname, "android/app/src/main/AndroidManifest.xml");

if (!existsSync(MANIFEST)) {
  console.error(`[inject-permissions] AndroidManifest tidak ditemukan: ${MANIFEST} (jalankan setelah 'cap add android').`);
  process.exit(1);
}

const ENTRIES = [
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />',
  '<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />',
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
];

let xml = readFileSync(MANIFEST, "utf8");
const nameOf = (e) => e.match(/android:name="([^"]+)"/)[1];
const missing = ENTRIES.filter((e) => !xml.includes(nameOf(e)));

if (missing.length === 0) {
  console.log("[inject-permissions] semua izin sudah ada.");
} else {
  xml = xml.replace(/(\n\s*)<application/, `$1${missing.join("$1")}$1$1<application`);
  writeFileSync(MANIFEST, xml);
  console.log(`[inject-permissions] ditambahkan: ${missing.map(nameOf).join(", ")}`);
}
