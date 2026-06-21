// Menyalin ikon brand Zylora (android-app/branding/res) ke project Android yang
// di-generate (android-app/android/.../res) + set warna latar adaptive-icon ke
// biru brand. Dijalankan saat build (lokal & CI) agar APK selalu pakai ikon
// Zylora, bukan ikon default Capacitor. Tanpa dependensi (pakai fs bawaan).
import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "branding", "res");
const DST = join(here, "android", "app", "src", "main", "res");

if (!existsSync(SRC)) { console.error("[inject-icons] branding/res tidak ada — lewati"); process.exit(0); }
if (!existsSync(DST)) { console.error("[inject-icons] project Android belum ada (jalankan cap add/sync dulu)"); process.exit(0); }

let n = 0;
for (const dir of readdirSync(SRC)) {           // mipmap-mdpi, hdpi, ...
  const sdir = join(SRC, dir), ddir = join(DST, dir);
  mkdirSync(ddir, { recursive: true });
  for (const f of readdirSync(sdir)) { copyFileSync(join(sdir, f), join(ddir, f)); n++; }
}

// Latar adaptive-icon → biru brand (#1B3D72).
const bgFile = join(DST, "values", "ic_launcher_background.xml");
if (existsSync(bgFile)) {
  const s = readFileSync(bgFile, "utf8").replace(/#FFFFFF/i, "#1B3D72");
  writeFileSync(bgFile, s);
}
console.log(`[inject-icons] ${n} ikon Zylora terpasang + latar adaptive #1B3D72`);
