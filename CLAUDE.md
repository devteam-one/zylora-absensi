# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **Figma Make export** for "Absensi Digital dengan QR-Code" — an interactive
*prototype* of a QR-based employee attendance system. There is **no backend and no
persistence**: every employee, attendance record, and leave request is hardcoded
mock data in `src/app/App.tsx` and lives only in React state. UI language is
Indonesian; dates/times use the `id-ID` locale.

## Commands

```bash
npm i           # install dependencies (or: pnpm i — this is a pnpm workspace)
npm run dev     # Vite dev server (single server; the ":5173/:5174" UI is a metaphor — see below)
npm run build   # vite build → dist/
```

There is **no lint, test, or typecheck script**, and no `tsconfig.json`. Vite/esbuild
strips TypeScript types without checking them, so type errors will NOT fail the build —
review types by reading, not by running a checker.

`react`/`react-dom` are declared only as **optional `peerDependencies`** (see
`package.json`), so a bare `pnpm i` may not install them. If a build/dev start fails on a
missing React, run `pnpm add -D react@18.3.1 react-dom@18.3.1` (or verify
`node_modules/react` exists first). `pnpm-workspace.yaml` defines a single-package (`.`)
workspace.

## Architecture

The whole app is one self-contained file, **`src/app/App.tsx`**. The chain is
`index.html` → `src/main.tsx` → `App.tsx`. `react-router` is a dependency but is **not
used** — there is no routing; navigation is local component state.

`App.tsx` is organized in clearly commented sections: Types → static mock data
(`EMPLOYEES`, `INITIAL_ATTENDANCE`, `INITIAL_LEAVE`, `STATUS_CFG`, `DEPT_COLORS`) →
helpers/hooks (`useClock`, `useDynamicQR`) → shared UI (`StatusBadge`, `Avatar`,
`MethodBadge`) → two "system models" → root `App`.

### Two system models × two "ports" (the core concept)

The root `App` holds all shared state (`attendance`, `leaveRequests`, plus
`systemMode` and `activePort`) and renders one of **four** views. Two top-bar
selectors switch between them:

- **`systemMode`** — `"qr_lokasi"` (QR shown at the location, employee scans it with
  their phone) vs `"terminal_scan"` (a kiosk terminal reads the employee's QR/ID card).
- **`activePort`** — `"5173"` (employee phone app / kiosk) vs `"5174"` (admin dashboard).

The four view components are `QRLokasiEmployeeApp`, `QRLokasiAdminPanel`,
`TerminalScanKiosk`, `TerminalAdminDashboard`.

**The ":5173" / ":5174" labels are a presentation device, not real ports** — everything
runs on a single Vite dev server. The point being demonstrated is that the employee-facing
view and the admin view share the *same* state, so a simulated check-in instantly
appears on the admin dashboard. When changing data flow, keep state lifted in `App` and
passed down via props (`onCheckIn`/`onCheckOut`, `setLeaveRequests`) so this "real-time
sync" illusion holds.

Check-in/out is simulated: scanner components use `setTimeout` to fake a scan, then call
the lifted `onCheckIn`/`onCheckOut` handlers. `useDynamicQR` produces a rotating token
(`ABSENSI-NUSANTARA-JKT-<time-window>`) and renders the QR image via an external
`api.qrserver.com` URL.

## Styling

Tailwind **v4**, configured entirely in CSS (no `tailwind.config.js`). `main.tsx` imports
a single entry, **`src/styles/index.css`**, which `@import`s three files in order:
- `src/styles/fonts.css` — remote Google Fonts (`Plus Jakarta Sans` + `DM Mono`).
- `src/styles/tailwind.css` — `@import 'tailwindcss' source(none)` with an explicit
  `@source '../**/*.{js,ts,jsx,tsx}'` glob, plus `@import 'tw-animate-css'`.
- `src/styles/theme.css` — design tokens as CSS variables (`--primary: #1B3D72`,
  `--accent: #0EA472`, `--background`, `--radius`, fonts, etc.) exposed to Tailwind via
  `@theme inline`, plus the `@layer base` element defaults.

(`src/styles/globals.css` exists but is **empty and unused** — ignore it.) Do **not** add
`tailwindcss`/`autoprefixer` to `postcss.config.mjs` — `@tailwindcss/vite` handles that
(the file documents this).

In practice `App.tsx` styles with raw Tailwind utilities + `lucide-react` icons, and
mixes token classes (`bg-primary`, `text-muted-foreground`) with **hardcoded brand
hex** (`bg-[#1B3D72]`, `bg-[#0D1B2A]`). Match the surrounding style when editing.

The 48 `src/app/components/ui/*` files are **shadcn/ui** (Radix-based) components shipped
with the export but **not used by `App.tsx`**. Reach for them only if building something
new; the `cn()` helper lives in `src/app/components/ui/utils.ts`.

## Conventions

- Path alias **`@` → `src`** (defined in `vite.config.ts`).
- A custom Vite plugin resolves `figma:asset/<file>` imports to `src/assets/<file>`
  (that directory does not exist yet — create it if you add Figma assets).
- `vite.config.ts` warns not to remove the React or Tailwind plugins, and not to add
  `.css/.ts/.tsx` to `assetsInclude`.

## Design-sync tooling (auxiliary, not the app)

`.design-sync/` and `.ds-sync/` are a **separate toolchain** that syncs the 46
`components/ui/*` files as a component library to a DesignSync backend — unrelated to
running the attendance prototype. Most of it is gitignored (`.ds-sync/`,
`.design-sync/.cache/`, etc.), but `.design-sync/NOTES.md` is tracked and is the **source
of truth** for its quirks (forcing IPv4 for npm, the node-sandbox network block that
requires running `.ds-sync/install-deps.sh` in a normal terminal, why `srcDir` is pinned
to the `ui` dir). Read that file before touching anything under those directories; don't
duplicate its details here.
