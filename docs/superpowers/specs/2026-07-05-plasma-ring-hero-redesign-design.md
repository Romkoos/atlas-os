# Plasma Ring Hero Redesign

**Date:** 2026-07-05
**Status:** Approved

## Summary

Redesign the Dashboard StatusRow (KPI hero band) from a flat 4-tile bento into a
3-column asymmetric bento where a full-height Canvas-animated **Plasma Ring** occupies
the center column as the visual anchor. The ring shows real-time Claude subscription
utilization and time-to-reset in a theatrically spectacular way: it pulses, vibrates,
and intensifies proportionally to how close the user is to their rate limit.

---

## Problem

The current StatusRow is four small mono-text tiles. It carries important data
(tokens, efficiency, sessions, runs) but looks flat and adds no ambient energy to
the dashboard. There is no prominent live representation of how much of the Claude
subscription window has been consumed or how long until it resets.

---

## Layout Architecture

Replace `.kpis.bento` (4-tile, 2-row grid) with a **3-column asymmetric bento**:

```
┌─────────────────┬──────────────────────┬─────────────────┐
│ [01] TODAY       │                      │ [03] SESSIONS   │
│  TOKENS          │   ◉  PLASMA RING     │  30D            │
│  234,891         │                      │  47             │
├─────────────────│       72%            ├─────────────────┤
│ [02] EFFICIENCY  │   resets 01:23:45   │ [04] AGENT RUNS │
│  87%  ░░░arc     │                      │  312            │
└─────────────────┴──────────────────────┴─────────────────┘
```

**CSS grid:** `grid-template-columns: 1fr 1.6fr 1fr`
- Center column 1.6× wider than the flanks — ring dominates.
- Left and right columns are inner grids: `grid-template-rows: 1fr 1fr` (two equal tiles).
- All three columns stretch to the same height (the ring's square drives the height).

---

## Plasma Ring — Visual Specification

### Component: `PlasmaRing`

A `<canvas>` element animated via `requestAnimationFrame`. Accepts:
- `utilization: number` — 0–1
- `tone: 'good' | 'warn' | 'bad'`
- `width / height: number` — responsive, set from container

**DPR:** canvas logical size matches `width/height`; internal pixel buffer is
`width * devicePixelRatio` so it stays crisp on retina. Context scaled once on
mount / resize via `ctx.scale(dpr, dpr)`.

### Canvas Layers (bottom → top)

1. **Track ring** — full 360° thin arc, `rgba(fg, 0.08)`. Ghost of the maximum.
2. **Main arc** — thick stroke (~10 px) from 0 to `utilization × 2π`. Color per tone.
3. **Leading-edge bloom** — bright point at arc tip; `shadowBlur` 24–40 px, same color.
4. **Ring jitter** — radius oscillates ±N px via a lightweight noise function.
   Frequency and amplitude both scale with utilization.
5. **Orbital particles** — 8–12 small dots orbit along the ring radius, each leaving
   a short alpha-fading trail. Speed proportional to utilization.
6. **Inner core pulse** — central radial gradient; `opacity = sin(t × freq) × util`.
   Gives the ring a "breathing power core" feel.
7. **Outer corona** — 3–4 semi-transparent arcs at increasing radii, creating soft
   outward glow.

### Animation Parameters by Utilization

| utilization | pulse freq | jitter amp | particle speed | glow intensity |
|---|---|---|---|---|
| 0–50 % | 0.5 Hz | ±2 px | slow | 0.4 |
| 50–75 % | 1.0 Hz | ±3 px | medium | 0.6 |
| 75–90 % | 1.5 Hz | ±4 px | fast | 0.8 |
| 90–100 % | 2.5 Hz | ±6 px | very fast | 1.0 |
| rejected | 3+ Hz + red flash | ±8 px | frantic | 1.0 |

All parameters interpolate continuously — no hard jumps between bands.

### Color Palette (smooth lerp, not hard switch)

- **good** (≤ 75 %): `--amber` `oklch(0.8 0.17 75)` — warm, calm
- **warn** (75–90 %): orange `oklch(0.75 0.20 55)` — attention
- **bad** (≥ 90 % / rejected): red `oklch(0.70 0.25 25)` — alarm

Color interpolates between stops as utilization crosses thresholds.

### HTML Overlay (centered over canvas)

```
     72%          ← 42px mono, tone color
  RESETS IN       ← 10px fg-3, uppercase tracking
  01:23:45        ← 20px mono tabular-nums, live 1-second countdown
  pro · usage     ← 10px fg-4 (plan · rateLimitType)
```

The overlay is an absolutely-positioned `<div>` inside the same relative container
as the canvas. Canvas receives `pointer-events: none` so the text is selectable.

### States

**Idle (no data yet):**
- Ring rotates slowly at 25 % fill, dim amber, no particles, low glow.
- Text center: `—%` in fg-3, `AWAITING DATA` sub-label.

**Active (utilization known):**
- Full animation as specified above.

**Rejected (limit hit):**
- Arc fills to 100 %, aggressive red flash pulse on the inner core.
- Particles move frantically.
- Center text: `LIMIT REACHED` in bad-red, countdown below.

---

## Component: `UsagePlasmaWidget`

Wrapper that:
1. Subscribes to `trpc.subscriptionUsage.watch`.
2. Drives a client-side 1-second `setInterval` for the countdown (same pattern as
   the existing `SubscriptionWidget`).
3. Measures its container via `ResizeObserver` and passes `width/height` to `PlasmaRing`.
4. Renders the HTML text overlay.
5. Exposes a CSS class `plasma-widget` for the container so the center column can
   flex-stretch the canvas to fill the full bento height.

---

## Data Flow

No new back-end work. The pipeline already exists end-to-end:

```
SDK rate_limit_event
  → subscriptionUsage.ts (main-side singleton cache)
    → trpc.subscriptionUsage.watch (tRPC subscription streamed to renderer)
      → UsagePlasmaWidget (React, 1-s countdown interval)
        → PlasmaRing (props: utilization, tone — Canvas + rAF)
```

`gaugeTone` and `formatCountdown` from `subscription-gauge.ts` are reused unchanged.

---

## StatusRow Restructure

`StatusRow` in `Dashboard.tsx` is refactored:

**Before:** single `.kpis.bento` 4-column grid containing four `.kpi` tiles.

**After:** `.kpis-hero` container with three children:

```jsx
<div className="kpis-hero bento">
  {/* Left stack */}
  <div className="kpis-hero-left">
    <div className="kpi kpi-today">…TODAY TOKENS…</div>
    <div className="kpi kpi-eff">…TOKEN EFFICIENCY…</div>
  </div>

  {/* Center: Plasma Ring */}
  <UsagePlasmaWidget />

  {/* Right stack */}
  <div className="kpis-hero-right">
    <div className="kpi">…SESSIONS 30D…</div>
    <div className="kpi">…AGENT RUNS…</div>
  </div>
</div>
```

The `kpi.hero` (2×2 span) and `kpi.wide` (2-col span) classes are no longer used in
this row — layout is owned by the new grid.

---

## Rail Cleanup

`SubscriptionWidget` is **removed** from `Dashboard.tsx`'s `.dash-rail`. Its functionality
is fully superseded by `UsagePlasmaWidget` in the hero. The `SubscriptionWidget.tsx`
file is kept but no longer rendered (avoids deletion churn if it's useful elsewhere).

The rail shrinks from 4 slots to 3: `TokenHeatmap`, `KnowledgePulse`, `BenchmarkWidget`.
CSS `.dash-rail` keeps `grid-template-rows: repeat(3, minmax(0, 1fr))` — already correct.

---

## New CSS Classes

| Class | Purpose |
|---|---|
| `.kpis-hero` | Outer 3-col grid (`1fr 1.6fr 1fr`), replaces `.kpis.bento` |
| `.kpis-hero-left` / `.kpis-hero-right` | Inner `1fr 1fr` vertical stacks |
| `.plasma-widget` | Center column container; `position: relative`, fills height; `min-height: 220px` so ring looks substantial even on short viewports |
| `.plasma-overlay` | Absolutely-centered HTML text over canvas |
| `.plasma-overlay .pct` | Big % number (42 px mono, tone-colored) |
| `.plasma-overlay .countdown` | HH:MM:SS line (20 px mono tabular-nums) |
| `.plasma-overlay .sub` | "RESETS IN" label and plan·type footer (10–11 px) |

---

## Files Changed

| File | Change |
|---|---|
| `src/renderer/src/components/dashboard/PlasmaRing.tsx` | **NEW** — Canvas + rAF animation component |
| `src/renderer/src/components/dashboard/UsagePlasmaWidget.tsx` | **NEW** — tRPC data connector + HTML overlay |
| `src/renderer/src/pages/Dashboard.tsx` | Refactor `StatusRow` to 3-col layout; remove `SubscriptionWidget` from rail |
| `src/renderer/src/index.css` | Add `.kpis-hero`, `.plasma-widget`, `.plasma-overlay` CSS; keep existing `.kpi` styles |
| `src/renderer/src/components/dashboard/SubscriptionWidget.tsx` | Remove from rendered output (file kept) |

---

## Dependencies

No new npm packages. Uses only:
- Canvas 2D API (native browser)
- `requestAnimationFrame` (native)
- `ResizeObserver` (native)
- Existing `trpc.subscriptionUsage.watch`
- Existing `gaugeTone`, `formatCountdown` from `subscription-gauge.ts`

---

## Out of Scope

- Storing historical utilization data (no time-series chart)
- Token budget display (plan token estimates — the authoritative source is the SDK event)
- Accessibility / reduced-motion variant (follow-up if needed)
