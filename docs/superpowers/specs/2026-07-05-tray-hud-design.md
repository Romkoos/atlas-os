# Menu-bar (Tray) HUD — Design

**Date:** 2026-07-05
**Status:** Approved (pre-implementation)

## Summary

Add a macOS menu-bar (`Tray`) HUD to Atlas OS. A menu-bar icon toggles a small,
frameless **popover window** that shows, live:

- **Running jobs** — from the job registry (`src/main/services/jobs`).
- **Today's activity** — tokens today, turns/sessions, and efficiency (KPI).
- **Token spend / usage** — the subscription usage rings (session 5h + weekly 7d).

Every readout is driven by the **same data the Dashboard uses** (the same tRPC
subscriptions/queries and renderer hooks), so the HUD never drifts from the main
window. Clicking an item focuses/opens the main window on the relevant page. The
tray persists after the main window is closed.

## Goals

- A rich, live popover HUD anchored under the menu-bar icon.
- Zero duplication of KPI/token/job data logic — reuse existing hooks/queries.
- Clicking a HUD item opens/focuses the main window on the right page.
- The app keeps running (tray + dock) when the main window is closed.

## Non-goals

- No pure menu-bar (background/`LSUIElement`) mode — the dock icon stays.
- No new metrics or aggregations — the HUD only surfaces existing data.
- No Windows/Linux-specific tray styling work (the code is cross-platform via
  Electron `Tray`, but the design targets macOS menu-bar behavior).

## Architecture

A `Tray` in the **main process** owns a frameless **popover `BrowserWindow`**
that renders a **second, lightweight React entry** (`tray.html` → `tray.tsx`).
The popover is wrapped in the *same* `AppProviders` as the main renderer, so it
reuses the existing tRPC-over-IPC client (`ipcLink` → `window.atlasTrpc`),
react-query, and theme. It subscribes to the same data paths the Dashboard uses:

| HUD section        | Data source (reused)                                   |
|--------------------|--------------------------------------------------------|
| Running jobs       | `useJobs()` → `trpc.jobs.list` subscription            |
| Today (tokens/turns)| `trpc.productivity.today`                              |
| Efficiency (EFF)   | `trpc.productivity.kpi` (`overall`)                    |
| Usage rings        | `useUsageData()` → subscription usage snapshot         |

## Components

### 1. Main process — `src/main/tray.ts`

`createTray({ ensureMainWindow }): TrayHandle`

- Creates a `Tray` from a **template icon** (monochrome PNG, auto-adapts to
  light/dark menu bar), sets a tooltip.
- Lazily builds the **popover window**:
  - `frame: false`, `show: false`, `resizable: false`, `skipTaskbar: true`,
    `alwaysOnTop: true`, `fullscreenable: false`, fixed size (~`340 × 480`).
  - Same preload as the main window (`preload/index.cjs`); `contextIsolation`,
    `sandbox: true`.
  - Loads `tray.html` — dev: `${ELECTRON_RENDERER_URL}/tray.html`; prod: the
    built `tray.html` next to `index.html`.
- **Toggle** on tray `click`: if the popover is visible → `hide()`; else compute
  position and `show()` + `focus()`.
- **Position**: centered horizontally under the tray icon using
  `tray.getBounds()`, clamped into the work area of
  `screen.getDisplayNearestPoint(...)`. Extracted as a **pure function**
  `popoverPosition(trayBounds, winSize, workArea) → { x, y }` for unit testing.
- **Auto-hide**: on popover `blur` → `hide()` (skipped while its DevTools are
  open, so it can be inspected).
- **Right-click** native context menu fallback: "Open Atlas OS", "Quit".
- Returns a handle exposing `destroy()`.
- **Icon asset**: a small monochrome `trayTemplate.png` (+ `@2x`) added under a
  `resources/` directory, resolved by absolute path from `app.getAppPath()` /
  `__dirname`, loaded via `nativeImage` with template mode enabled.

### 2. Popover renderer — `src/renderer/tray.html` + `src/renderer/src/tray.tsx`

- `tray.html` mirrors `index.html` but its script is `/src/tray.tsx`.
- `tray.tsx` mounts `<TrayHud/>` inside `AppProviders` (same providers as the
  main app).
- `TrayHud` (new `src/renderer/src/pages/tray/TrayHud.tsx` + `tray.css`) renders
  the agreed sections, top → bottom:
  1. **Header** — "ATLAS.OS" wordmark + status dot → navigates to `dashboard`.
  2. **Today** — TOKENS TODAY (total), TURNS / SESSIONS, EFF → navigates to
     `productivity`.
  3. **Usage** — session (5h) + weekly (7d) utilization values from
     `useUsageData()` → navigates to `dashboard`.
  4. **Running jobs** — `useJobs().running`: label, elapsed (`formatDuration`),
     optional detail; abort "✕" when `cancellable` (`trpc.jobs.cancel`). Empty
     state: "no active processes". Row/section click → `dashboard`.
  5. **Footer** — "Open Atlas" (focus window) + "Quit".
- Compact, self-contained styling; reuses `dash-utils` formatters (`num`,
  `compact`, `pct`, `formatDuration`). Not the full Dashboard chrome.

### 3. Navigation & lifecycle bridge

- **Preload** (`src/preload/index.ts`): extend `AtlasBridge` with a `tray` group:
  - `navigate(section: string): void` → `tray:navigate`
  - `openMain(): void` → `tray:open`
  - `quit(): void` → `tray:quit`
  - `hide(): void` → `tray:hide`
- **Shared types** (`src/shared/bridge.ts`): add the `tray` interface.
- **Main**: `ensureMainWindow()` — a small helper (in `window.ts` or `index.ts`)
  that returns the existing main window, or recreates it (reusing the current
  `app.on('activate')` create-and-build-menu path) if it was closed. IPC handlers:
  - `tray:navigate` → `ensureMainWindow()`, `show()`+`focus()`,
    `webContents.send('navigate', section)`, then hide the popover.
  - `tray:open` → `ensureMainWindow()`, `show()`+`focus()`, hide popover.
  - `tray:quit` → `app.quit()`.
  - `tray:hide` → hide popover.
- **Lifecycle**: `createTray(...)` is called once in `app.whenReady()`.
  `window-all-closed` remains: quit only off-darwin (unchanged) — so on macOS the
  tray keeps the app alive after the window closes. The tray lives for the app's
  lifetime; dock icon stays.

### 4. Build config — `electron.vite.config.ts`

- Add a second renderer input:
  `renderer.build.rollupOptions.input = { index: …/index.html, tray: …/tray.html }`.
- No preload/main config changes; the popover shares the existing preload.

## Data flow

1. Tray icon clicked → main positions & shows the popover window.
2. Popover renderer boots `AppProviders` → opens tRPC-over-IPC subscriptions
   (`jobs.list`, subscription usage) and queries (`productivity.today/kpi`) —
   identical to the Dashboard; react-query/electron-IPC dedupe naturally.
3. Registry `emit('change')` / usage poll updates stream to the popover exactly
   as they do to the Dashboard; the HUD re-renders live.
4. A HUD click → `window.atlas.tray.navigate(section)` → main ensures/focuses the
   window, sends `navigate`, hides the popover.

## Error handling & edge cases

- **Window recreated after close**: `ensureMainWindow()` rebuilds the window +
  menu; navigation waits for it to exist before sending `navigate`.
- **Popover before first show**: built lazily and kept hidden; `blur`-hide guarded
  so DevTools inspection works.
- **Empty/idle states**: jobs list shows "no active processes"; usage shows the
  existing idle "—%"; today shows "—" when no activity (mirrors Dashboard).
- **Multi-display / menu-bar position**: `popoverPosition` clamps x/y into the
  nearest display's work area so the popover never renders off-screen.

## Testing

- **Unit** (`src/main/tray.position.test.ts`): `popoverPosition()` — centers under
  the icon, clamps to the left/right work-area edges, sits below the menu bar.
  Pure function, no Electron runtime.
- **Manual** (`pnpm dev`): menu-bar icon appears; click toggles the popover;
  jobs/today/EFF/usage are live and match the Dashboard; abort works; clicking
  sections focuses the main window on the right page; closing the main window
  keeps the tray, and the tray/dock reopen it.

## File-change inventory

**New**
- `src/main/tray.ts` — tray + popover window + IPC handlers + `popoverPosition`.
- `src/main/tray.position.test.ts` — position math tests.
- `src/renderer/tray.html` — popover HTML entry.
- `src/renderer/src/tray.tsx` — popover React entry.
- `src/renderer/src/pages/tray/TrayHud.tsx` — HUD component.
- `src/renderer/src/pages/tray/tray.css` — HUD styles.
- `resources/trayTemplate.png` (+ `@2x`) — menu-bar icon asset.

**Modified**
- `src/main/index.ts` — call `createTray`, wire `ensureMainWindow`.
- `src/main/window.ts` — export/support `ensureMainWindow` (or host it in index).
- `src/preload/index.ts` — add `atlas.tray` bridge.
- `src/shared/bridge.ts` — add `tray` types.
- `electron.vite.config.ts` — add the `tray` renderer entry.
