# KPI (Efficiency) Metric + Chart — Design

**Date:** 2026-05-23
**Status:** Approved (design)
**Area:** Productivity page (Atlas OS)

> **Term:** the user calls this the system's КПД (efficiency). The UI/code label is
> **KPI**. Here KPI denotes one specific metric — an **efficiency ratio** of value
> delivered per token spent (defined below) — not the generic "any performance
> indicator" sense. Single number, higher = better.

## Problem

The Productivity tracker measures how ecosystem changes (MCP / skills / CLAUDE.md /
configs — "наши системы") affect agent **quality** and **token use**. It already
shows tokens, complexity, ratings, and a tokens-per-turn before/after table per
ecosystem change — but there is no single **KPI** that combines *value delivered*
against *tokens spent*, and no chart of it over time.

We want this KPI and to plot it over time, with ecosystem-change markers, so a glance
answers: *did adding this MCP / skill / config make the system more efficient?*

## Definition

KPI is an **efficiency percentile coefficient (0–100%)**, volume-independent.

Per session, raw efficiency:
```
rawEff = (score ?? 5.5) × complexity / tokens
```
That raw value is **percentile-ranked across the whole tracked session corpus** (the
same `percentileRanks` machinery that powers `complexity`), giving each session a
rank in `[0,1]`. A session with no `complexity` or no `tokens` is unrankable and
excluded.

- **Coefficient (0–100%)** for any set of sessions = **mean of members' percentiles × 100**, equal weight per session (NOT token-weighted). Bounded, smooth, independent of how many tokens or sessions.
- **Decisions locked with user:** numerator = score × complexity; unrated `score` → 5.5; all sessions counted; the metric is a *relative percentile* (centered ~50% by construction) so the long-run baseline recenters as the corpus grows, but before/after comparisons still surface change.

### Per-day KPI (chart)
`kpi_day = mean(percentile of each session whose last turn fell on that day) × 100`.

### Day attribution
Each session is bucketed on the local-calendar day of its **last turn**
(`max(agent_turns.ts)`, SQL `date(...,'localtime')`), so day keys align with
`tokensByDay`/`ecosystemDays` for the `EcoMarkers` overlay. See [[recharts-v3-overlay-markers]].

### Overall KPI (card) & per-session column & before/after
Same mean-of-percentiles × 100, over the window's sessions / a single session /
each before-after window respectively.

## Scope (this change)

Full vertical, four surfaces:

1. **Chart** "KPI (efficiency)" on the Overview tab — KPI per day over time, with the
   `EcoMarkers` ⚑ overlay for ecosystem-change days.
2. **Metric card** "KPI" in the Overview top card row.
3. **Column** "KPI" in the Sessions table (per-session value).
4. **Before/after** KPI in the Ecosystem → "Change impact" table — KPI of the window
   before vs after each change, so each system edit's efficiency effect is visible.

## Architecture & data flow

Reuse existing patterns; minimize new backend surface.

### Backend — `src/main/trpc/routers/productivity.ts`

**New procedure `kpi`** (input: shared `rangeInput` = `{days?, projectPath?}`):

- Resolve window + `projectCondition` exactly like `overview` (respects the
  tracked-project allowlist and the optional single-project filter).
- Get window session ids from `agent_turns` (same `turnFilter` as the other views).
- Per session, get the **last-turn local day** via SQL:
  `select sessionId, date(max(ts)/1000,'unixepoch','localtime') as day ... group by sessionId`
  over the windowed turns. This is the day bucket.
- Pull `score`, `totalTokensIn`, `totalTokensOut` from `agent_sessions` for those ids.
- `complexity` from the existing `sessionComplexityMap()` (corpus percentile, read-time).
- Accumulate per day: `sumQC += (score ?? 5.5) × complexity`, `sumTok += tokens`.
  `kpi_day = sumQC / (sumTok / 1e6)` (guard `sumTok === 0` → skip the day).
- Return:
  ```ts
  {
    byDay: { date: string; kpi: number; sessions: number; tokens: number }[]  // sorted by date
    overall: number | null  // token-weighted KPI over the whole window
  }
  ```
- Skip sessions with `complexity == null` or `tokens === 0` (defensive; shouldn't occur
  for tracked sessions).

**Extend `ecosystemImpact`** — add KPI before/after alongside the existing tokens/turn:

- It currently buckets **turns** into before/after windows. KPI is session-grained, so
  additionally bucket **sessions** (by last-turn day vs the change `ts`) into the same
  before/after windows and compute window KPI = `Σ(score×comp)/(Σtokens/1e6)` per side.
- Add output fields: `kpiBefore: number | null`, `kpiAfter: number | null`,
  `kpiDeltaPct: number | null`. Existing token fields unchanged.
- Reuse `sessionComplexityMap()`; load the candidate sessions once (like the single turn
  pass) bounded by `earliest`.

No schema/migration changes — all inputs already exist in `agent_sessions` /
`agent_turns`. KPI is always computed at read time (like complexity), so it never goes
stale.

### Frontend — `src/renderer/src/pages/Productivity.tsx`

- **Shared helper** `kpi(score: number | null, complexity: number | null, tokens: number)`
  → `number | null`, using `score ?? 5.5`, returning null when `complexity == null` or
  `tokens === 0`. Used by the Sessions column.
- **OverviewTab:**
  - Add `trpc.productivity.kpi.useQuery({ days, projectPath })`.
  - New card `<MetricCard label="KPI" value={dash(kpiData.overall)} />`. The card grid is
    currently `lg:grid-cols-4` with 4 cards (Total tokens, Sessions, Avg score, Avg
    complexity) → make it 5 cards; widen to `lg:grid-cols-5` (keep `grid-cols-2` on small).
  - New `<Card>` "KPI (efficiency)" after "Tokens per day". Recharts `LineChart` (KPI is a
    rate, not a stacked volume — a line reads better than bars), single `<Line dataKey="kpi">`
    with `var(--color-chart-1)`. Same XAxis date config as Tokens-per-day (`value.slice(5)`,
    `preserveStartEnd`). Reuse the **union-of-dates** build (KPI days ∪ event days,
    null-filled) and render `<EcoMarkers events={eventDays} />` as a child so change markers
    align. Custom tooltip showing date, KPI, sessions, and the event label (mirror
    `TokensTooltip`).
  - Empty state: if `kpi.byDay` is empty, show the same "No … yet" hint as the tokens chart.
- **SessionsTab:** add a "KPI" column (header right-aligned, after Complexity). Value =
  `dash(kpi(s.score, s.complexity, s.totalTokens))`. No router change.
- **EcosystemTab "Change impact" table:** add two columns — "KPI before" / "after" — and
  show the KPI delta. KPI delta is "higher = better", the **opposite** of the existing
  tokens-per-turn `ImpactDelta`. Generalize `ImpactDelta` with a `goodDirection: 'up' |
  'down'` prop (default `'down'` to preserve current tokens behavior; pass `'up'` for KPI)
  so green/red flips correctly.
- **RatingControl consistency:** change the placeholder `<option value="">— (7)</option>`
  to `— (5.5)` so the stated unrated default matches the KPI imputation. (The "7" was
  cosmetic — nothing consumed it before; KPI is the first consumer.)

## Error handling & edge cases

- `tokens === 0` → KPI null (guarded both backend and in the `kpi` helper); such days are
  dropped from `byDay`, such cells render `—`.
- `complexity == null` (session missing from corpus map) → skipped / `—`.
- No sessions / no rated sessions → `overall` null → card shows `—`; chart shows empty hint.
- Timezone: all day bucketing happens in SQL `localtime`, matching tokens-per-day and
  ecosystem days, so markers never drift by a day.
- Single-session corpus: `percentileRanks` returns 0.5 → complexity ≈ 5.5 (existing
  behavior, unchanged).

## Testing

- **Backend (vitest, pure logic):** factor the KPI math into a small pure helper
  (`kpiByDay(sessions)` / `kpiWindow(sessions)` taking `{score, complexity, tokens, day}`)
  in `src/main/services/productivity/` so it is unit-testable without the Electron-ABI DB
  (same split rationale as ingest in [[productivity-tracker-atlas-design]]). Cover:
  token-weighting (heavy session dominates), unrated → 5.5, all-rated, mixed, zero-token
  guard, empty → null, per-day grouping.
- **Typecheck + build + lint** green (`pnpm` scripts as in the existing workflow).
- **Manual / e2e:** KPI chart renders with `EcoMarkers` aligned; card and Sessions column
  populate; Change-impact KPI columns colour up=green. (Electron Playwright harness per
  [[recharts-v3-overlay-markers]] if run.)

## Out of scope

- No new DB columns / migrations.
- No change to how `score` is collected (still user-only via `setRating`).
- No per-project KPI breakdown in the "By project" table (could follow later).
- No persisted/cached KPI — always read-time.

## Naming

UI label "KPI" / chart "KPI (efficiency)". Code identifiers in English: tRPC procedure
`kpi`, fields `kpi` / `kpiBefore` / `kpiAfter` / `kpiDeltaPct`, helper `kpi(...)` +
`kpiByDay` / `kpiWindow`.

(Revised 2026-05-23: KPI is now a percentile coefficient. Shared helpers: `rawEfficiency`, `kpiCoefficient`, `kpiByDay`, `UNRATED_SCORE`, type `KpiDaySession`. Router builds `sessionEfficiencyMap()` mirroring `sessionComplexityMap()`.)
