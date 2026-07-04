# Subscription Usage Gauge — Design Spec
_2026-07-04_

## Goal

Add a real-time radial arc gauge to the dashboard KPI row that shows how much of the user's Claude subscription has been consumed in the current 5-hour rolling window, and how long until that window resets.

---

## Background

Claude subscriptions (Pro / Max 5x / Max 20x) allow a rolling 5-hour token budget. When the budget is exhausted Claude Code stops responding until the window resets. Atlas already tracks per-turn token usage in the `agentTurns` table (populated by `ingest.ts`). We surface this data as a gauge in the existing KPI row.

---

## Data Layer

### Source
`agentTurns` table — columns used: `ts` (timestamp_ms), `tokensIn`, `tokensOut`.

No new table or migration needed.

### Window calculation (server-side)
1. Query all turns with `ts >= now - 5h`, ordered by `ts ASC`.
2. `windowStart` = timestamp of the earliest turn in that set (or `now` if no turns yet).
3. `windowReset` = `windowStart + 5h`.
4. `tokensUsed` = `SUM(tokens_in + tokens_out)` for turns in range.
5. `limitTokens` = read from settings (`subscriptionPlan` → lookup table, or `subscriptionLimitCustom` if plan = `custom`).

### New tRPC procedure: `productivity.subscriptionWindow`

```ts
// input: none
// output:
{
  tokensUsed: number        // sum of in+out for last 5h
  windowStart: Date         // earliest turn in window (or now)
  windowReset: Date         // windowStart + 5h
  limitTokens: number       // from settings
  fillPct: number           // tokensUsed / limitTokens * 100, capped at 100
}
```

Client polls with `refetchInterval: 60_000` (60 s). Countdown is driven client-side from `windowReset` via `setInterval(1000)` — no server round-trip per second.

---

## Settings

### New fields in `src/shared/settings.ts`

```ts
subscriptionPlan: z.enum(['pro', 'max5x', 'max20x', 'custom']).default('pro')
subscriptionLimitCustom: z.number().int().positive().default(50_000)
```

### Plan → token limit lookup (shared constant)

```ts
export const SUBSCRIPTION_LIMITS: Record<string, number> = {
  pro:   50_000,
  max5x: 250_000,
  max20x: 1_000_000,
}
```

These are community-derived estimates; Anthropic does not publish exact numbers. The user can override via `custom`.

### Settings UI

New section **"Claude Subscription"** on the Settings page:

- Dropdown: `Pro / Max 5x / Max 20x / Custom`
- If `custom` is selected: number input labelled "Token limit per 5-hour window"
- Footer note: *"Limits are estimates — adjust if your plan differs"*

---

## Component: `UsageGauge.tsx`

Location: `src/renderer/src/components/dashboard/UsageGauge.tsx`

### Visual spec

- **SVG arc**, 270° sweep, center of the tile
- Track ring: thin (4 px stroke), `--color-amber-dim` (same as existing gauge tracks)
- Fill arc: 6 px stroke, gradient amber (`#F59E0B`) → orange (`#F97316`) → red (`#EF4444`) mapped to 0–100%
- **Center top:** `HH:MM:SS` countdown — large mono font, amber color. Updates every second.
- **Center bottom:** `42.3k / 250k` — compact, dimmed label
- **>80% fill:** CSS keyframe `pulse-glow` — `filter: drop-shadow(0 0 6px #F59E0B)` oscillating every 1.4 s
- **Fill animation:** `transition: stroke-dashoffset 0.8s ease` triggered on each 60 s data refresh
- **Empty state (no turns yet):** arc at 0%, countdown shows `05:00:00` (full window), label shows `0 / Xk`

### Countdown logic

```ts
// inside component, on mount / when windowReset changes
const [remaining, setRemaining] = useState(calcRemaining(windowReset))
useEffect(() => {
  const id = setInterval(() => setRemaining(calcRemaining(windowReset)), 1000)
  return () => clearInterval(id)
}, [windowReset])
```

`calcRemaining(windowReset)` = `Math.max(0, windowReset - Date.now())` → formatted as `HH:MM:SS`.

---

## Dashboard KPI Grid Reorganization

### Current layout (4-column bento)

```
col:  1    2    3    4
row1: [ TODAY TOKENS 2×2 ] [ TOKEN EFFICIENCY 2×1 ]
row2: [                  ] [ SESSIONS ]  [ RUNS   ]
```

### New layout (4-column bento, same grid)

```
col:  1        2          3    4
row1: [ TODAY ] [ GAUGE  ] [ TOKEN EFFICIENCY 2×1 ]
row2: [ TODAY ] [ GAUGE  ] [ SESSIONS ]  [ RUNS   ]
```

Changes:
- `TODAY TOKENS`: CSS class changes from `kpi hero` (2×2) → `kpi hero-tall` (1×2). Font size stays large; the tile is narrower.
- New `USAGE GAUGE` tile: class `kpi gauge-tile` (1×2). Contains `<UsageGauge />`.
- `TOKEN EFFICIENCY`, `SESSIONS`, `AGENT RUNS`: unchanged.

### New CSS classes in `index.css`

```css
.kpi.hero-tall {
  grid-column: span 1;
  grid-row: span 2;
  /* same padding/font as .kpi.hero */
}

.kpi.gauge-tile {
  grid-column: span 1;
  grid-row: span 2;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/shared/settings.ts` | + `subscriptionPlan`, `subscriptionLimitCustom`, `SUBSCRIPTION_LIMITS` constant |
| `src/main/trpc/routers/productivity.ts` | + `subscriptionWindow` procedure |
| `src/renderer/src/components/dashboard/UsageGauge.tsx` | **create** |
| `src/renderer/src/pages/Dashboard.tsx` | reorganize KPI grid, add `<UsageGauge />` tile |
| `src/renderer/src/index.css` | + `.kpi.hero-tall`, `.kpi.gauge-tile`, `.usage-gauge` SVG styles, `pulse-glow` keyframe |
| `src/renderer/src/pages/Settings.tsx` | + "Claude Subscription" section |

No new npm dependencies.

---

## Out of Scope

- Fetching live data from Anthropic servers (no official individual-account API)
- Tracking claude.ai web usage (separate quota, no local data)
- Per-model breakdown within the window
