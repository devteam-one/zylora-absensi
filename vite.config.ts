import { defineConfig } from 'vite'
import path from 'path'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Identitas versi terpusat (sumber tunggal: version.json) + metadata build.
const VINFO = JSON.parse(readFileSync(path.resolve(__dirname, 'version.json'), 'utf8'))
const BUILD_SHA = (process.env.GITHUB_SHA || (() => {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'local' }
})()).slice(0, 7)
const BUILD_DATE = process.env.BUILD_DATE || new Date().toISOString()


// Stempel VERSION cache service worker dengan id build unik tiap kali build.
// Tanpa ini sw.js byte-nya identik antar-rilis, sehingga browser/WebView Capacitor
// menganggap SW tak berubah, tak pernah re-install, dan terus menyajikan shell lama
// (penyebab "APK/PWA tidak menampilkan perubahan"). Id diambil dari GITHUB_SHA di
// CI, atau timestamp saat build lokal.
function swVersionStamp() {
  let outDir = 'dist'
  const buildId =
    (process.env.GITHUB_SHA || '').slice(0, 7) ||
    process.env.BUILD_ID ||
    String(Date.now())
  return {
    name: 'zylora-sw-version-stamp',
    apply: 'build' as const,
    configResolved(cfg) {
      outDir = cfg.build.outDir
    },
    closeBundle() {
      const swPath = path.resolve(__dirname, outDir, 'sw.js')
      if (!existsSync(swPath)) return
      const src = readFileSync(swPath, 'utf8')
      const stamped = src.replace(
        /const VERSION = "[^"]*";/,
        `const VERSION = "zylora-${buildId}";`,
      )
      writeFileSync(swPath, stamped)
      console.log(`[sw-version-stamp] sw.js → VERSION "zylora-${buildId}"`)
    },
  }
}

// Cegah build produksi (APK/desktop/web) tanpa VITE_API_URL: tanpa itu api.ts
// jatuh ke default backend PRODUKSI (fallback hardcoded di src/app/api.ts) — bundel
// diam-diam menunjuk server produksi & APK rilis bisa tampak "tak berubah"/kosong.
// Default kini FAIL-CLOSED (build gagal). Untuk build lokal yang SENGAJA memakai
// fallback, set VITE_ALLOW_NO_API_URL=1 (peringatan saja). VITE_REQUIRE_API_URL lama
// tetap dihormati (kini redundan karena default sudah gagal).
function apiUrlGuard() {
  return {
    name: 'zylora-api-url-guard',
    apply: 'build' as const,
    buildStart() {
      if (process.env.VITE_API_URL) return
      const banner = [
        '',
        '  ⚠️  VITE_API_URL belum di-set untuk build ini.',
        '     api.ts akan default ke backend PRODUKSI (fallback hardcoded di',
        '     src/app/api.ts) — build ini menunjuk ke server produksi, BUKAN',
        '     localhost. Untuk dev lokal: VITE_API_URL=http://127.0.0.2:5181 ...',
        '     Untuk rilis: VITE_API_URL=https://api-anda <perintah build>.',
        '',
      ].join('\n')
      // Escape hatch eksplisit untuk build lokal yang sadar memakai fallback.
      if (process.env.VITE_ALLOW_NO_API_URL) {
        console.warn('\x1b[33m%s\x1b[0m', banner)
        return
      }
      console.warn('\x1b[33m%s\x1b[0m', banner)
      this.error('VITE_API_URL wajib di-set (build fail-closed). Set VITE_API_URL=<url>, atau VITE_ALLOW_NO_API_URL=1 untuk build lokal yang sengaja memakai fallback.')
    },
  }
}

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    apiUrlGuard(),
    swVersionStamp(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  // Expose the per-server role to the app deterministically. Empty (default) =
  // original single-port build; 'employee'/'admin' = the two-port split that
  // syncs through server/sync-server.mjs. See the "dev:employee"/"dev:admin"
  // scripts in package.json.
  define: {
    'import.meta.env.VITE_ROLE': JSON.stringify(process.env.VITE_ROLE || ''),
    // versionCode build (sama dgn versionCode Android) untuk cek update OTA in-app.
    'import.meta.env.VITE_VERSION_CODE': JSON.stringify(process.env.VITE_VERSION_CODE || '0'),
    // Identitas versi (SemVer) + metadata build — sumber tunggal version.json.
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(VINFO.version),
    'import.meta.env.VITE_APP_NAME': JSON.stringify(VINFO.name),
    'import.meta.env.VITE_APP_PRODUCT': JSON.stringify(VINFO.product),
    'import.meta.env.VITE_APP_CHANNEL': JSON.stringify(VINFO.channel),
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(BUILD_SHA),
    'import.meta.env.VITE_BUILD_DATE': JSON.stringify(BUILD_DATE),
  },
})
