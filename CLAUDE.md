# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Zylora** — "Absensi Digital dengan QR-Code", a QR/barcode employee-attendance +
light-HRIS system. It began as a **Figma Make export** (a no-backend React prototype)
but is now a **real full-stack app**: a zero-dependency Node backend with SQLite
persistence (`server/api/`) is the source of truth, and the frontend reads/writes it over
REST. UI language is **English** (migrated from Indonesian 2026-06-24); dates/times use the
`en-US` locale. Backend `ApiError` messages are English too. Brand name is **Zylora** (the
original "Nusantara" mock identity is gone).

> The prototype heritage still shows: there is **no lint/test/typecheck script and no
> `tsconfig.json`** (Vite/esbuild strips TS types without checking — type errors do NOT
> fail the build; review types by reading). And several files are **legacy scaffolding
> kept for reference** — see "Legacy / dead code" below before extending anything.

## Commands

```bash
pnpm i            # install (pnpm workspace; npm i also works)

# ── Frontend dev (one Vite server per role, all on 127.0.0.2) ──
pnpm dev:employee # role 'employee'  → http://127.0.0.2:5173  (employee phone app)
pnpm dev:control  # role 'control'   → http://127.0.0.2:5174  (admin "Sistem Kontrol")
pnpm dev:display  # role 'display'   → http://127.0.0.2:5175  (public QR/barcode screen)
pnpm dev          # bare `vite` with NO role → shows a "no role set" placeholder, not useful

# ── Backend (Zylora API) ──
pnpm api          # node server/api/server.mjs → http://127.0.0.2:5181 (no seed by default)
ZYLORA_SEED=1 pnpm api    # seed demo data if DB empty

# ── Everything at once (backend + 2 frontends) ──
pnpm dev:zylora   # ZYLORA_SEED=1 api + employee:5173 + control:5174

# ── Production builds (one static site per role) ──
VITE_API_URL=https://api.example.com ./deploy/build-frontends.sh
                  # → dist-employee/ , dist-control/ , dist-display/
```

**Critical local-dev gotcha:** the API base URL comes from `VITE_API_URL`; when unset,
`src/app/api.ts` **defaults to the production EC2 backend**, not localhost. So `pnpm
dev:employee` / `dev:zylora` alone will talk to *production*. To exercise the **local**
backend, set it explicitly:

```bash
VITE_API_URL=http://127.0.0.2:5181 pnpm dev:employee
```

(`127.0.0.2` is a free loopback alias — another project on this machine already uses
`127.0.0.1:5173/5174`, so all Zylora servers deliberately bind `127.0.0.2`.)

`react`/`react-dom` are declared as **optional `peerDependencies`**, so a bare `pnpm i`
may not install them. If dev/build fails on missing React, run
`pnpm add -D react@18.3.1 react-dom@18.3.1` (or check `node_modules/react` exists first).

Backend requires **Node ≥ 22** (uses the built-in `node:sqlite`); tested on Node 24.

## Architecture

### The role model (the core concept — replaces the old "two ports" metaphor)

There is **one** frontend bundle (`src/app/App.tsx`) and **one** backend. Which UI renders
is decided entirely by the build-time env var **`VITE_ROLE`**, surfaced in the app as
`APP_ROLE` (`src/app/App.tsx`, top). The root `App()` (bottom of the file) is a switch:

| `VITE_ROLE` | Component | Who / where |
|-------------|-----------|-------------|
| `employee`  | `QRLokasiEmployeeApp` | employee phone app — login (ID+PIN), scan location QR to check in/out |
| `control`   | `QRLokasiControlPanel` | admin dashboard ("Sistem Kontrol") — **desktop-only** (blocked on Capacitor/native) |
| `display`   | `QRDisplayPage` | public kiosk screen showing the rotating location QR; no login |
| *(unset)*   | placeholder screen | safety net; real builds always set a role |

`vite.config.ts` bakes `VITE_ROLE` into `import.meta.env.VITE_ROLE` via `define`, so the
value is fixed at build time per output (`dist-employee/`, `dist-control/`,
`dist-display/`). The "two system models × two ports (`:5173`/`:5174`)" selector from the
original prototype has been **removed** — do not reintroduce that chrome.

### Frontend ↔ backend

- **`src/app/api.ts`** is the single REST client. `BASE = VITE_API_URL || <prod EC2>`.
  Every backend call goes through the exported `api` object (typed). When adding endpoints,
  add the typed method here, not ad-hoc `fetch` in components.
- **`useBackendData(enabled)`** hook (in `App.tsx`, ~line 1534) drives the **control**
  panel: login (JWT token held in state + persisted to `localStorage`), then **polls** the
  backend on an interval (`POLL_MS`). `QRDisplayPage` and the employee app poll similarly.
  There is **no live socket** — sync is poll-based.
- The employee app and display page restore their session from `localStorage` tokens on
  refresh (validating via `api.me` / `api.company`).

### Backend (`server/api/`) — zero-dependency Node

Built on **`node:http` + `node:sqlite` + `node:crypto` only** — no Express, no bcrypt, no
jsonwebtoken, no DB driver. This is deliberate: the project documents an npm/network block
(see `.design-sync/NOTES.md`), so a dependency-free backend is guaranteed to run. Deploy =
copy `server/api/`, no `npm install`. The authoritative backend overview is
**`server/api/README.md`** — read it before changing API behavior.

Layout (modular):
- `server.mjs` — entry: builds the router, mounts `/health` + `/api/version`, calls
  `registerAll`, seeds **only if `ZYLORA_SEED=1`**, listens on `127.0.0.2:5181`.
- `routes/index.mjs` aggregates `routes/*.routes.mjs` (auth, company, employees, locations,
  config, attendance, public, employee, payroll).
- `lib/`: `db.mjs` (SQLite schema + helpers — ~17 relational tables: companies, admins,
  sessions, employees, employee_codes, locations, location_codes, attendance, shifts,
  leave_requests, devices, audit_logs, salary_components, payroll_rules, payroll_runs,
  exchange_rates, payslips), `security.mjs` (scrypt hashing, HS256 JWT, id gen), `qr.mjs`
  (static/dynamic/personal token generation + image URL), `http.mjs` (Router, body reader,
  JSON/error helpers), `middleware.mjs` (`requireControl`/`requireEmployee` RBAC,
  `rateLimit`, `audit`), `validate.mjs`, `attendance-core.mjs` (haversine geofence,
  check-in/out recording), `payroll-core.mjs`.
- `seed.mjs` — demo data (control `kontrol@nusantara.co.id` / `kontrol1234`; employees
  `EMP001–EMP008` / PIN `123456`).
- `data/zylora.db` — runtime SQLite (**gitignored**; delete to reset). Production starts
  **clean** (no seed) — real tenants register via `POST /api/control/register`.

**Auth & RBAC:** two separate roles, both JWT HS256, sessions stored in the `sessions`
table (logout = revoke). `control` tokens (email+password, 8h) reach dashboard endpoints;
`employee` tokens (employeeId+PIN, 12h) reach only `/api/me/*`. Cross-role access → 403.
Set `ZYLORA_SECRET` in production.

**Attendance scan flow (the heart of the system):** `POST /api/attendance/checkin` (or the
token-authenticated `/api/me/checkin`) verifies, in order: **identity** (signed personal
code, or the employee token) → **location QR validity** (static exact-match / dynamic
within a time window) → **GPS position** within the location radius (haversine). `hadir` vs
`terlambat` is derived from the employee's schedule; double check-in → 409.

### Legacy / dead code — do NOT extend

- **`server/sync-server.mjs`** — an SSE relay from the abandoned "2 real ports sharing
  state" experiment. The real backend superseded it. `App.tsx` keeps the old relay-mode
  code blocks "as reference" (commented), and `pnpm dev:2port` still wires the relay, but
  the live app uses REST polling, not SSE. New work should target the REST backend.
- The original single-port prototype demo chrome (model selector, mock data, `:5173`/`:5174`
  tabs) has been stripped (`git log` for "Buang scaffolding prototipe").

## Frontend file map

Almost the entire UI is the single file **`src/app/App.tsx`** (~1800 lines), in commented
sections: helpers/hooks (`useClock`, `useOnline`, `useDynamicQR`, `getDeviceGps`,
`QrScanner` using `html5-qrcode`) → shared UI (`StatusBadge`, `Avatar`, `MethodBadge`,
`OfflineBanner`, `UpdateBanner`, `VersionTag`) → the three role views → control-panel tabs
(`EmployeeManagerTab`, `LokasiTab`, `ShiftTab`, `DeviceTab`, `RiwayatTab`,
`PengaturanTab`, `LogTab`, `PayrollTab`, `KursTab`) → `useBackendData` → root `App`.

`react-router` is a dependency but **not used** — navigation is local component state. The
48 `src/app/components/ui/*` files are **shadcn/ui** (Radix) shipped with the export but
**not used by `App.tsx`**; reach for them only when building something new (`cn()` helper:
`src/app/components/ui/utils.ts`).

## Styling

Tailwind **v4**, configured entirely in CSS (no `tailwind.config.js`). `main.tsx` imports
`src/styles/index.css`, which `@import`s in order: `fonts.css` (remote Google Fonts —
`Plus Jakarta Sans` + `DM Mono`), `tailwind.css` (`@import 'tailwindcss' source(none)` +
explicit `@source` glob + `tw-animate-css`), `theme.css` (design tokens as CSS variables:
`--primary: #1B3D72`, `--accent: #0EA472`, `--background: #EEF2F7`, radius, fonts, exposed
to Tailwind via `@theme inline`, plus `@layer base` defaults). `globals.css` is empty and
unused. Do **not** add `tailwindcss`/`autoprefixer` to `postcss.config.mjs` —
`@tailwindcss/vite` handles that.

`App.tsx` mixes token classes (`bg-primary`, `text-muted-foreground`) with **hardcoded
brand hex** (`bg-[#1B3D72]`, `bg-[#0D1B2A]`). Match the surrounding style when editing.

## Versioning & build plumbing (`vite.config.ts`)

- **`version.json` (repo root) is the single source of truth** for product identity
  (SemVer `1.0.0`, name, channel). `vite.config.ts` reads it and injects
  `import.meta.env.VITE_APP_VERSION` / `_NAME` / `_PRODUCT` / `_CHANNEL` / `_BUILD_SHA` /
  `_BUILD_DATE`. The backend reads the same file (or its deployed copy) for `/api/version`.
  `server/api/version.json` is a generated/stamped copy and is **gitignored** — edit the
  root `version.json`.
- **`swVersionStamp` plugin** rewrites `dist/**/sw.js`'s `VERSION` constant per build so
  PWA/Capacitor WebViews actually re-install the service worker (otherwise an unchanged
  `sw.js` keeps serving the old shell — the classic "APK/PWA shows no changes" bug).
- **`apiUrlGuard` plugin** warns (or fails, if `VITE_REQUIRE_API_URL=1`) when building
  without `VITE_API_URL`, since the loopback default is unreachable from real devices.
- `VITE_VERSION_CODE` is injected for in-app OTA update checks (`UpdateBanner`).

## Packaging & deployment

- **Web (production):** `deploy/build-frontends.sh` builds three static sites
  (`dist-employee/` `dist-control/` `dist-display/`), each baking `VITE_API_URL`. Host on
  separate domains. All `dist-*` are gitignored.
- **Backend → EC2:** `deploy/deploy.sh` SSH-copies `server/api/` (excluding `data/`),
  installs Node 22, writes `/etc/zylora.env`, runs it as the `zylora-api` systemd service
  behind nginx + TLS bound to `127.0.0.1:5181`. See `deploy/README.md`. `ZYLORA_SECRET` is
  mandatory in production.
- **Android APK:** `android-app/` (Capacitor wrapping the `employee`/`display` PWA). Built
  in **GitHub Actions** (`.github/workflows/android-apk.yml`) because the local machine
  lacks the Android SDK/Gradle. See `android-app/README.md` (appId `id.zylora.absensi`).
- **Desktop installer:** `desktop-app/` (Electron wrapping the `control` PWA, `--base ./`).
  Built per-OS in CI (`.github/workflows/desktop-control.yml`). See `desktop-app/README.md`.

## Conventions

- Path alias **`@` → `src`** (`vite.config.ts`).
- A custom Vite plugin resolves `figma:asset/<file>` imports to `src/assets/<file>` (that
  directory does not exist yet — create it if you add Figma assets).
- `vite.config.ts` warns not to remove the React or Tailwind plugins, and not to add
  `.css/.ts/.tsx` to `assetsInclude`.
- Commit messages in this repo are **Indonesian + leading emoji** (see `git log`).

## Design-sync tooling (auxiliary, not the app)

`.design-sync/` and `.ds-sync/` are a **separate toolchain** that syncs the
`components/ui/*` files to a DesignSync backend — unrelated to running Zylora. Most is
gitignored, but **`.design-sync/NOTES.md` is tracked and is the source of truth** for its
quirks (forcing IPv4 for npm, the node-sandbox network block that requires running
`.ds-sync/install-deps.sh` in a normal terminal, why `srcDir` is pinned to the `ui` dir).
Read that file before touching anything under those directories.
