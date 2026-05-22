# Atlas OS — AI Tools Control Panel Starter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship a working macOS Electron starter (AI tools control panel) with one full end-to-end vertical slice: button → streaming Claude SDK call → save to SQLite + `.md` file → live render in UI.

**Architecture:** Electron with strict process isolation. Renderer = React webview, zero Node access. Main = backend (DB, files, SDK). Typed IPC via electron-trpc; every procedure has Zod input/output. Streaming tokens flow main→renderer via a tRPC subscription. Full ESM, TypeScript strict.

**Tech Stack:** Electron 42 · electron-vite 5 · React 19 · TS strict · Tailwind 4 · shadcn/ui · Zustand · TanStack Query · Recharts · RHF + Zod · electron-trpc + tRPC 11 · better-sqlite3 + Drizzle · electron-store · electron-log · @anthropic-ai/sdk · electron-builder · Biome · Vitest · Playwright · pnpm · Volta.

---

## File Map

```
atlas-os/
  package.json .npmrc .nvmrc .gitignore biome.json
  electron.vite.config.ts electron-builder.yml drizzle.config.ts
  tsconfig.json tsconfig.node.json tsconfig.web.json
  vitest.config.ts playwright.config.ts components.json README.md
  drizzle/                          # generated SQL migrations (shipped)
  src/
    shared/                         # types shared main<->renderer (NO node imports)
      models.ts                     # Claude model id constants
      ipc-events.ts                 # stream event shapes
    main/
      index.ts                      # app lifecycle, window, menu, trpc handler
      window.ts menu.ts paths.ts
      logger.ts store.ts            # electron-log, electron-store(encrypted)
      db/{client.ts,schema.ts,migrate.ts}
      services/{anthropic.ts,files.ts}
      trpc/{trpc.ts,context.ts,router.ts}
      trpc/routers/{health.ts,settings.ts,agent.ts,stats.ts}
    preload/{index.ts,index.d.ts}
    renderer/
      index.html
      src/
        main.tsx App.tsx index.css env.d.ts
        lib/{trpc.ts,query.ts,utils.ts,ipc.ts}
        store/ui.ts                 # zustand (active tab)
        providers/ThemeProvider.tsx
        components/ErrorBoundary.tsx components/layout/Sidebar.tsx
        components/ui/*              # shadcn copies (button,card,input,...)
        pages/{Dashboard.tsx,Stats.tsx,Settings.tsx}
```

## Security baseline (non-negotiable)
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes only electron-trpc bridge + a tiny typed api. No raw ipc.
- API key in electron-store with `encryptionKey` (obfuscation). Never logged, never in DB. README TODO: macOS Keychain.

---

## Phase 1 — Skeleton
Scaffold structure, tooling, three empty sections rendering.
- package.json (scripts, deps split: main-runtime→dependencies, renderer/build→devDependencies, Volta + engines), .npmrc (engine-strict), .nvmrc.
- electron.vite.config.ts (main/preload/renderer, @tailwindcss/vite, path aliases).
- tsconfig (strict, aliases @shared/@main/@renderer), biome.json, .gitignore.
- Tailwind v4 via CSS import, index.css with theme tokens (light/dark vars).
- shadcn components.json + hand-added ui primitives (button, card, input, label, select, tabs, sonner).
- App shell: Sidebar + 3 pages (Dashboard/Stats/Settings) switched by Zustand tab state.
- **Verify:** `pnpm dev` opens window, 3 sections render, no console errors. `pnpm typecheck` clean. **Commit `feat(skeleton):`**

## Phase 2 — Infrastructure
- better-sqlite3 + Drizzle: schema `events` table, client, migrate-on-start, paths.ts (userData db path; resources migrations path).
- drizzle.config.ts + generate first migration into ./drizzle.
- electron-log: file transport with rotation, console in dev.
- electron-store: encrypted settings store with typed schema + defaults.
- electron-trpc bridge: trpc init (superjson), context, router with `health.ping`. Preload exposeElectronTRPC. Renderer trpc client + TanStack Query provider.
- Dashboard calls `health.ping`, shows result.
- **Verify:** ping round-trips main→renderer; db file + migration created; log file written. **Commit `feat(infra):`**

## Phase 3 — Settings
- settings router: `get`/`set`/`reset` (Zod in/out), `chooseDirectory` (dialog.showOpenDialog), reading/writing electron-store.
- Renderer Settings page: RHF + Zod form (apiKey password+mask, model select from shared models, output dir + Choose folder, theme system/light/dark, logLevel). Save/Reset buttons, toasts.
- ThemeProvider: applies system/light/dark instantly; persists via settings.
- Wire logLevel → electron-log level on change.
- **Verify:** fields persist across restart; theme switches instantly; folder dialog works. **Commit `feat(settings):`**

## Phase 4 — Vertical slice
- anthropic service: streaming `messages.stream`, AbortController, emits token/done/error.
- agent router: `run` subscription (Zod input prompt/model) → yields stream events; on done writes `.md` to output dir + inserts `events` row (type, model, tokens, filePath, ts, durationMs); `cancel` via abort. `openFile` mutation → shell.showItemInFinder.
- files service: write md, ensure dir, open in Finder.
- Dashboard: Run agent button (disabled+spinner while running), live token block, Cancel button (AbortController), success toast "Saved to {path}" + Open file action; readable error toasts; global ErrorBoundary.
- **Verify (needs API key):** stream renders live; on done file exists + row inserted + toast; cancel aborts cleanly. **Commit `feat(vertical-slice):`**

## Phase 5 — Stats
- stats router: `summary` (count, avg duration, avg length, last run) + `daily` (events/day last 30d) via Drizzle SQL aggregation. Unit-test the date-bucketing/SQL helper with Vitest.
- Stats page: Recharts bar/line of daily; metric cards; Refresh (TanStack Query refetch).
- **Verify:** chart shows real data after runs; Refresh updates. **Commit `feat(stats):`**

## Phase 6 — Production
- electron-builder.yml (dmg, mac target, asarUnpack native + better-sqlite3, extraResources drizzle migrations, appId, productName). electron-updater config present, `checkForUpdates()` NOT called (TODO).
- postinstall electron-rebuild; simple-git-hooks pre-commit (biome + tsc); Volta pins; .nvmrc; engines.
- README: prereqs, dev/build/dist, real paths (db/settings/logs/outputs), troubleshooting, ascii arch diagram, TODO list (signing, notarization, auto-update activation, Keychain, MCP, skills, chat UI, more providers).
- **Verify:** `pnpm build` clean; `pnpm dist` produces .dmg. **Commit `chore(production):`**

---

## Self-Review notes
- Every tRPC procedure: Zod input + output. ✓ enforced per router.
- Single source of truth for db types: Drizzle `$inferSelect` re-exported from shared. ✓
- No secrets in DB/logs: key only in encrypted store; logger redaction. ✓
- No hardcoded model ids/paths/ports in renderer: models from `@shared/models`, paths from settings. ✓
- Native modules limited to better-sqlite3. ✓
