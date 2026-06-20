# design-sync notes — Absensi Digital QR-Code

Repo-specific gotchas for future syncs. One bullet per quirk.

## Repo nature
- This is a **Figma Make app export**, NOT a published design system. The synced library is the
  46 shadcn/ui component files under `src/app/components/ui/`. The app itself (`src/app/App.tsx`)
  does NOT import them — it uses raw Tailwind + lucide. So there is no real-world usage to mine for
  preview composition; previews are authored from shadcn conventions + the repo's theme tokens.
- No package build, no `dist/`, no `main`/`module`/`exports` in package.json, no committed lockfile.
  Runs in the converter's **synth-entry mode** (bundles components straight from source TSX).

## Build environment
- **Network: force IPv4.** `registry.npmjs.org` resolves to IPv6 first here but IPv6 is dead in this
  sandbox (`EAI_AGAIN` / fetch failed). Always export `NODE_OPTIONS=--dns-result-order=ipv4first`
  for every npm/pnpm/node command, plus `COREPACK_ENABLE_STRICT=0`.
- `react`/`react-dom` are only OPTIONAL peerDependencies (package.json) so pnpm does not install them
  by default — but `pnpm i` here DID pull them as direct deps because they're referenced; verify
  `node_modules/react` exists before building. If missing: `pnpm add -D react@18.3.1 react-dom@18.3.1`.

## Converter config (.design-sync/config.json)
- `srcDir` is pinned to `src/app/components/ui` ON PURPOSE: the default src root (`src/`) would pull
  `src/main.tsx` into the synth entry, whose top-level `createRoot(...).render(<App/>)` would execute
  on bundle load and hijack/crash every preview. Keep srcDir scoped to the components dir.
- `componentSrcMap` pins exactly 46 primary exports (one card per file). Without it, synth-derive
  would emit every sub-export (CardHeader, DialogContent, …) as separate ungrouped cards.
- Special primary names (NOT the filename): `chart.tsx`→`ChartContainer`, `resizable.tsx`→
  `ResizablePanelGroup`, `sonner.tsx`→`Toaster`. `ImageWithFallback` (figma/) is intentionally excluded.

## CSS / Tailwind v4 (the main fidelity risk)
- Components are styled ONLY with Tailwind v4 utility classes bound to theme tokens (`bg-primary`,
  `text-muted-foreground`, …). There is no compiled stylesheet in the repo, and `vite build` would
  only emit utilities used by App.tsx (which doesn't use these components).
- Strategy: compile the project's own `src/styles/index.css` (its `@source '../**/*'` already covers
  the ui dir) into `.design-sync/compiled.css` with the Tailwind CLI, and point `cfg.cssEntry` at it.
  This file holds the `:root` design tokens + every utility the components need.
- Fonts are remote Google Fonts (`@import url(fonts.googleapis.com …)` in fonts.css) → `[FONT_REMOTE]`,
  informational, nothing to ship.

## Constraints
- **No subagents** (standing user preference): the §4 preview fan-out is done serially by the main agent.

## Claude Code sandbox blocks node's network (CRITICAL for installs)
- Inside the Claude Code agent sandbox, the `node` binary has NO outbound network — it
  cannot connect even to a raw IP or to `127.0.0.1` (raw TCP hangs; getaddrinfo→EAI_AGAIN).
  `curl`/`python3`/`getent` work fine (only node is blocked). `dangerouslyDisableSandbox`
  and unsetting `IS_SANDBOX` do NOT lift it.
- Consequence: pnpm/npm/playwright (all node) can't download anything from inside the sandbox.
  A Python CONNECT proxy doesn't help because the pnpm CLIENT is node and can't reach the proxy.
- Fix: run `.ds-sync/install-deps.sh` in a NORMAL terminal (outside Claude Code) to populate
  node_modules. After that, the converter build + render check + DesignSync upload all work
  from inside the sandbox (build is local-only; upload is backend-routed).
