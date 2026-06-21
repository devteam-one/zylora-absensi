// Sisipkan konfigurasi release signing ke app/build.gradle hasil `cap add`.
// Keystore + password dibaca dari ENV (di-set CI dari GitHub Secrets):
//   ZYLORA_KEYSTORE          path file .keystore/.jks
//   ZYLORA_KEYSTORE_PASSWORD password keystore
//   ZYLORA_KEY_ALIAS         alias kunci
//   ZYLORA_KEY_PASSWORD      password kunci
// Jika ENV tak ada → release di-tanda-tangani debug (tetap bisa sideload).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GRADLE = resolve(__dirname, "android/app/build.gradle");
if (!existsSync(GRADLE)) { console.error(`[inject-signing] build.gradle tak ada: ${GRADLE}`); process.exit(1); }

let g = readFileSync(GRADLE, "utf8");
if (g.includes("signingConfigs {")) { console.log("[inject-signing] signingConfig sudah ada."); process.exit(0); }

const block = `
    signingConfigs {
        release {
            def ks = System.getenv("ZYLORA_KEYSTORE")
            if (ks != null && !ks.isEmpty()) {
                storeFile file(ks)
                storePassword System.getenv("ZYLORA_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ZYLORA_KEY_ALIAS")
                keyPassword System.getenv("ZYLORA_KEY_PASSWORD")
            }
        }
    }`;

g = g.replace(/android\s*\{/, (m) => m + block);
g = g.replace(/(buildTypes\s*\{\s*release\s*\{)/,
  `$1\n            signingConfig System.getenv("ZYLORA_KEYSTORE") ? signingConfigs.release : signingConfigs.debug`);

writeFileSync(GRADLE, g);
console.log("[inject-signing] signingConfig release ditambahkan (prod bila ENV keystore di-set, selain itu debug).");
