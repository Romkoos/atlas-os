# Charts Upgrade — Design

**Date:** 2026-05-24
**Status:** Approved (brainstorm), pending implementation plan
**Scope:** All 4 charts in Atlas OS get a shared, explorable, self-explaining chart toolkit.

## Problem

The current charts (Productivity overview ×3, Stats events-per-day ×1) are read-only and
under-explained:

1. **Can't dig in** — no crosshair, no zoom/brush, no drill-down, no period comparison, no
   series toggles. The data can't be explored by hand.
2. **No compact "what is what"** — metrics like КПД (frozen-baseline efficiency), the quality
   line, and ⚑ ecosystem markers are non-obvious and lack inline legends/definitions.

Secondary: `Productivity.tsx` is 1295 lines with chart JSX inline, chart data built without
`useMemo` (re-renders on every parent update), and no reusable chart primitives.

## Goals

- All 4 charts upgraded and visually consistent (single terminal aesthetic: mono, amber,
  hairlines, no border-radius).
- Add interaction: synced crosshair + HUD readout, brush/zoom, click→drawer drilldown,
  compare-previous-period, series toggles.
- Add explanation layer: `//` mono caption (metric meaning) + legend chips (= toggles, with
  hover definition) + `?` popover (deep formula, e.g. КПД).
- Extract a reusable `components/charts/` toolkit; shrink and de-duplicate `Productivity.tsx`.

## Non-Goals

- No new chart *types* (heatmaps, distributions, correlations) — out of scope this round.
- No theme/color redesign — reuse existing `--chart-*` tokens.
- No change to КПД math / baseline model (see [[kpd-metric-redesign]]).

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Pain to fix | (1) can't explore data, (2) no compact inline explanations |
| Scope | all 4 charts, unified |
| Interaction patterns | **all four**: crosshair+HUD (synced), brush/zoom, click→drilldown, compare+toggles |
| Explanation layer | **all three layered**: `//` caption + legend chips (toggles) + `?` popover |
| Drilldown target | **side drawer** (slides in from right, chart stays visible) |
| Architecture | **shared toolkit, phased delivery** (3 phases) |

## Architecture

New module: `src/renderer/src/components/charts/`

| File | Responsibility | Depends on |
|---|---|---|
| `chartMeta.ts` | Single source of truth per chart: series defs `{ key, label, color, definition }` + metric definitions (КПД formula text, quality, ⚑ eco). Drives caption, chips, and `?` popover. | — |
| `ChartFrame.tsx` | Panel wrapper: head (title · `//` caption · `LegendChips` · `InfoPopover`) + body (chart children) + optional footer. Owns series-visibility state; exposes hidden-set to children. | `LegendChips`, `InfoPopover`, `chartMeta` |
| `LegendChips.tsx` | Chips row from series defs. Click toggles visibility (struck-through = off). Hover → series definition. | `chartMeta` |
| `InfoPopover.tsx` | `?` primitive — terminal-styled definition card on click/hover. Closes on Esc/outside-click. | — |
| `HoverSyncContext.tsx` | React context holding `{ activeDate \| null, source }`. Charts write on recharts `onMouseMove` (activeLabel) and clear on `onMouseLeave`. Also assigns a shared recharts `syncId` to the date-axis charts for the built-in vertical cursor. | — |
| `ChartReadout.tsx` | HUD panel rendering all series values at `activeDate`, sourced from `HoverSyncContext`. Sits with the synced date-axis charts. | `HoverSyncContext`, `chartMeta` |
| `RangeBrush.tsx` | Wraps recharts `<Brush>` styled to terminal. Lifts `startIndex/endIndex` to shared state so the date-axis charts zoom together. | — |
| `DayDrawer.tsx` | Right-side drawer (fixed, slide-in). Shows clicked day's sessions + breakdown (tokens, КПД, projects, top tools). Close on Esc / backdrop. | reuses `productivity.sessions` |

`ChartFrame` is the unit of consistency: each chart is `<ChartFrame meta={...}>{(hidden) => <Chart/>}</ChartFrame>`. Frame answers: what it shows (header from meta), how you use it (toggle chips, `?`), what it depends on (meta + children).

## Per-chart application

- **today-by-hour** (BarChart, hourly): `ChartFrame` + chips(in/out) + crosshair HUD (its own
  hour-axis readout, *not* synced to the date charts) + click hour → `DayDrawer` (today's
  sessions in that hour). No brush (only 24 bars).
- **tokens-per-day** (stacked BarChart, daily): full set — frame, chips(in/out/⚑),
  synced crosshair + `ChartReadout`, shared `RangeBrush`, compare-prev ghost overlay,
  click day → drawer. **Keep `EcoMarkers`.**
- **КПД · efficiency** (dual-axis LineChart, daily): frame, chips(КПД/quality/⚑), `?` = КПД
  formula, synced crosshair + readout, shared brush, compare-prev ghost line, **keep**
  `ReferenceLine y=100` and `EcoMarkers`.
- **events-per-day** (Stats BarChart, daily): frame, caption, crosshair HUD, brush,
  click day → drawer (events that day).

## Backend changes (minimal)

- **compare** → add optional `offset` (shift the window back N days) to `productivity.overview`
  and `productivity.kpi` inputs. Compare overlay = same `days` with `offset = days`; map the
  previous series onto the current axis by index for a ghost overlay. Stats compare optional.
- **drilldown** → reuse `productivity.sessions` (already windowed); filter by day on the client.
  No backend change at start. (Optional later: a `day` param for precision / out-of-window days.)
- **perf** → wrap chart-data construction (`chartData`, `kpiChartData`, union/zero-fill maps) in
  `useMemo` keyed on the source queries. Fixes the noted re-render pain.

## Phased delivery

- **Phase 1 — Legibility + crosshair (no backend).** `chartMeta` + `ChartFrame` + `LegendChips`
  + `InfoPopover` + `//` caption applied to all 4 charts. `HoverSyncContext` + `ChartReadout` +
  recharts `syncId` crosshair. Series toggles. `useMemo` on chart data. Highest value, zero
  backend risk.
- **Phase 2 — Zoom + compare.** `RangeBrush` (shared zoom on date charts) + compare-previous-
  period (backend `offset` param + ghost overlay on tokens-per-day and КПД).
- **Phase 3 — Drilldown.** `DayDrawer` across all charts (client-side session filter by day;
  optional `day` param if needed).

## Testing

- **Unit:** `ChartFrame` toggle state; `chartMeta` shape; `HoverSyncContext` set/clear;
  backend `offset` query (router test).
- **Manual:** launch the Electron app, verify each of the 4 charts per phase (crosshair sync,
  chips toggle, `?` popover, brush zoom, ghost overlay, drawer open/close).
- **Regression guard:** keep the `EcoMarkers` hook-based pattern (recharts v3 `ReferenceLine`
  on async data intermittently fails to paint — see [[recharts-v3-overlay-markers]]).

## Risks

- recharts `syncId` interplay with a custom single `ChartReadout` — validate hover state flows
  cleanly across both date charts.
- `<Brush>` styling to match terminal aesthetic; sharing brush window across two charts.
- Drawer for a clicked day outside the loaded session window (e.g. today chart) — MVP filters
  loaded data; note empties rather than silently showing nothing.
