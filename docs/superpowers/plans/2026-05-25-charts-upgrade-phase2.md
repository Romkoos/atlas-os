# Charts Upgrade — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared zoom (a `<Brush>` that scrubs both daily charts together) and a compare-previous-period ghost overlay (backend `offset` param + dim dashed line on tokens-per-day and Token Efficiency), plus a standalone brush on the Stats events-per-day chart.

**Architecture:** Pure logic lives in `.ts` files (unit-tested with vitest, node env). React UI lives in `.tsx` (verified by strict `tsc` + lint + manual app run; no testing-library in repo). Backend gains a pure `windowBounds(days, offset)` helper that turns a shifted range into `[lo, hi)` epoch bounds, wired into `productivity.overview` and `productivity.kpi`. On the frontend, both daily charts are rebuilt over **one shared date axis** so a single lifted `{startIndex,endIndex}` brush state maps 1:1 across them; the previous period is overlaid positionally via a pure `overlayPrevious` helper and drawn as a normal data series (not a `ReferenceLine`, which has the v3 async-paint quirk).

**Tech Stack:** React 19, recharts 3.8, TypeScript (strict), Tailwind v4 + CSS vars, vitest 4 (node), tRPC + react-query, drizzle-orm (better-sqlite3).

**Spec:** `docs/superpowers/specs/2026-05-24-charts-upgrade-design.md` (Phase 2 section).

**Conventions (read before starting):**
- Tests colocate as `*.test.ts` next to source; run with `pnpm test <path>`. vitest only globs `.ts` (not `.tsx`) and runs in **node** env — keep tested logic in `.ts`, no React/DOM in tests.
- Aliases: `@renderer`, `@main`, `@shared`. Class merge helper: `cn` from `@renderer/lib/utils`.
- Terminal aesthetic: mono (`var(--mono)`), amber (`var(--amber)`, `var(--amber-dim)`), chart colors `var(--color-chart-1..5)`, hairlines `var(--color-border)`, muted `var(--color-muted)` / `var(--color-muted-foreground)`, no border-radius.
- Keep the `EcoMarkers` component and `ReferenceLine y=100` exactly as-is (recharts v3 async-paint quirk — see project memory `recharts-v3-overlay-markers`). The ghost overlay is a real `<Line>` data series, which paints reliably (the kpi/quality lines already prove this), NOT a `ReferenceLine`.
- **recharts constraint:** `<Brush>` must be a *direct child* of the chart — recharts locates it via `findChildByType`. A custom component that returns `<Brush>` will NOT be detected. So we share styling through a spread-props constant (`brushProps`) and render `<Brush {...brushProps} … />` inline in each chart. (This is why the spec's `RangeBrush.tsx` becomes `rangeBrush.ts` exporting props, not a wrapper component.)
- Ignore the `git-commit-message` skill if it triggers (wrong repo — see memory `git-commit-message-skill-wrong-repo`). Write normal conventional-commit messages.
- Pre-commit hook runs `pnpm lint && pnpm typecheck`; every commit must pass both.

**Out of scope (deferred):** `DayDrawer` drilldown (Phase 3); today-by-hour crosshair HUD (a Phase-1 leftover); Stats compare overlay (spec marks Stats compare "optional").

---

## File Structure

| File | Type | Responsibility |
|---|---|---|
| `src/main/services/productivity/window.ts` | pure | `windowBounds(days, offset, now)` → `{ lo, hi }` epoch bounds. |
| `src/main/services/productivity/window.test.ts` | test | Bounds math: offset 0, offset shift, abutting periods, default. |
| `src/main/trpc/routers/productivity.ts` | modify | `offset` on `rangeInput`; window-based filtering in `overview` + `kpi`. |
| `src/renderer/src/components/charts/compareSeries.ts` | pure | `dailyDateAxis(...sources)` + `overlayPrevious(rows, key, prev)`. |
| `src/renderer/src/components/charts/compareSeries.test.ts` | test | Axis union/sort/dedupe; positional overlay incl. 0-vs-null. |
| `src/renderer/src/components/charts/rangeBrush.ts` | pure | `brushProps` styling constant + `BrushRange` type. |
| `src/renderer/src/pages/Productivity.tsx` | modify | Shared axis, lifted brush, compare toggle, ghost lines, tooltips. |
| `src/renderer/src/pages/Stats.tsx` | modify | Standalone `<Brush>` on events-per-day. |

---

## Task 1: backend window-bounds helper (pure + tested)

**Files:**
- Create: `src/main/services/productivity/window.ts`
- Test: `src/main/services/productivity/window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/productivity/window.test.ts
import { describe, expect, it } from 'vitest'
import { windowBounds } from './window'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

describe('windowBounds', () => {
  it('offset 0 → lower bound `days` back, no upper bound', () => {
    expect(windowBounds(30, 0, NOW)).toEqual({ lo: NOW - 30 * DAY, hi: null })
  })

  it('offset shifts the whole window back and adds an upper bound', () => {
    expect(windowBounds(30, 30, NOW)).toEqual({ lo: NOW - 60 * DAY, hi: NOW - 30 * DAY })
  })

  it('previous window abuts the current window with no gap or overlap', () => {
    const cur = windowBounds(7, 0, NOW)
    const prev = windowBounds(7, 7, NOW)
    expect(prev.hi).toBe(cur.lo) // prev ends exactly where current begins
  })

  it('defaults: offset 0, now = Date.now()', () => {
    const before = Date.now()
    const w = windowBounds(7)
    const after = Date.now()
    expect(w.hi).toBeNull()
    expect(w.lo).toBeGreaterThanOrEqual(before - 7 * DAY)
    expect(w.lo).toBeLessThanOrEqual(after - 7 * DAY)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/productivity/window.test.ts`
Expected: FAIL — `Failed to resolve import "./window"` / `windowBounds is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/services/productivity/window.ts
const DAY_MS = 24 * 60 * 60 * 1000

export interface TimeWindow {
  lo: number // inclusive lower bound (epoch ms)
  hi: number | null // exclusive upper bound; null = "up to now" (no cap)
}

// Bounds for a `days`-wide range optionally shifted back by `offset` days.
// offset = 0 → [now - days, now) with hi = null (unbounded top = current behavior).
// offset = days → the immediately-preceding period, used for compare overlays.
export function windowBounds(days: number, offset = 0, now: number = Date.now()): TimeWindow {
  return {
    lo: now - (days + offset) * DAY_MS,
    hi: offset > 0 ? now - offset * DAY_MS : null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/productivity/window.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/productivity/window.ts src/main/services/productivity/window.test.ts
git commit -m "feat(charts): add windowBounds helper for shifted compare ranges"
```

---

## Task 2: wire `offset` into the router (overview + kpi)

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

No new unit test (the router queries hit a real better-sqlite3 DB and there is no router test harness in the repo). Correctness is guaranteed by Task 1's tested math plus strict `tsc`. Verify by typecheck + the manual app run in Task 8.

- [ ] **Step 1: Add the `lt` import and the window helper import**

In the drizzle import (currently line 16), add `lt`:

```ts
import { and, avg, count, countDistinct, desc, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm'
```

Add a new import alongside the other `@main/services/productivity/*` imports (near line 11):

```ts
import { windowBounds, type TimeWindow } from '@main/services/productivity/window'
```

- [ ] **Step 2: Add a window→SQL helper and the `offset` input field**

Immediately after `cutoffDate` (line 19), add:

```ts
// agent_turns.ts condition for a computed window. hi == null leaves the top
// open (matches the legacy single lower-bound filter when offset = 0).
const turnTimeCond = (w: TimeWindow): SQL =>
  w.hi == null
    ? gte(agentTurns.ts, new Date(w.lo))
    : (and(gte(agentTurns.ts, new Date(w.lo)), lt(agentTurns.ts, new Date(w.hi))) as SQL)
```

In `rangeInput` (lines 23–28), add `offset` (default 0 = no shift, preserving every existing caller):

```ts
const rangeInput = z
  .object({
    days: z.number().int().positive().default(30),
    projectPath: z.string().optional(),
    offset: z.number().int().min(0).default(0),
  })
  .default({ days: 30 })
```

- [ ] **Step 3: Use the window in `overview`**

Replace the opening of the `overview` `.query` body (lines 242–243):

```ts
      const cutoff = cutoffDate(input.days)
      const scoped = turnFilter(cutoff, input.projectPath)
```

with:

```ts
      const win = windowBounds(input.days, input.offset)
      const scoped = and(turnTimeCond(win), projectCondition(input.projectPath))
```

Then in the same query, the `byProject` `.where` (line 291) changes from:

```ts
        .where(and(gte(agentTurns.ts, cutoff), trackedCondition()))
```

to:

```ts
        .where(and(turnTimeCond(win), trackedCondition()))
```

(Leave every other use of `scoped` untouched — it now reflects the shifted window automatically.)

- [ ] **Step 4: Use the window in `kpi`**

Replace the opening of the `kpi` `.query` body (lines 372–375):

```ts
      const cutoff = cutoffDate(input.days).getTime()
      const rows = scopedKpdRows(input.projectPath).filter(
        (r) => r.lastTs >= cutoff && r.kpd != null,
      )
```

with:

```ts
      const win = windowBounds(input.days, input.offset)
      const rows = scopedKpdRows(input.projectPath).filter(
        (r) => r.lastTs >= win.lo && (win.hi == null || r.lastTs < win.hi) && r.kpd != null,
      )
```

- [ ] **Step 5: Verify typecheck + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS, no errors. (`cutoffDate` and `turnFilter` remain used by `sessions`/`today`/`toolSkillUsage`/`coOccurrence`/`ecosystem`, so no unused-symbol warnings.)

- [ ] **Step 6: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(charts): add offset param to overview + kpi for compare period"
```

---

## Task 3: frontend pure helpers — shared axis + positional overlay (tested)

**Files:**
- Create: `src/renderer/src/components/charts/compareSeries.ts`
- Test: `src/renderer/src/components/charts/compareSeries.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/components/charts/compareSeries.test.ts
import { describe, expect, it } from 'vitest'
import { dailyDateAxis, overlayPrevious } from './compareSeries'

describe('dailyDateAxis', () => {
  it('unions dates across sources, ascending, deduped', () => {
    const a = [{ date: '2026-05-03' }, { date: '2026-05-01' }]
    const b = [{ date: '2026-05-02' }, { date: '2026-05-01' }]
    expect(dailyDateAxis(a, b)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('returns empty for no sources', () => {
    expect(dailyDateAxis()).toEqual([])
  })
})

describe('overlayPrevious', () => {
  it('writes prev values onto rows by index', () => {
    const rows = [{ date: 'a' }, { date: 'b' }]
    expect(overlayPrevious(rows, 'prev', [10, 20])).toEqual([
      { date: 'a', prev: 10 },
      { date: 'b', prev: 20 },
    ])
  })

  it('fills missing prev entries with null', () => {
    const rows = [{ date: 'a' }, { date: 'b' }]
    expect(overlayPrevious(rows, 'prev', [10])).toEqual([
      { date: 'a', prev: 10 },
      { date: 'b', prev: null },
    ])
  })

  it('keeps a prev value of 0 (does not treat it as missing)', () => {
    const rows = [{ date: 'a' }]
    expect(overlayPrevious(rows, 'prev', [0])).toEqual([{ date: 'a', prev: 0 }])
  })

  it('drops extra prev entries beyond rows', () => {
    const rows = [{ date: 'a' }]
    expect(overlayPrevious(rows, 'prev', [1, 2, 3])).toEqual([{ date: 'a', prev: 1 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/src/components/charts/compareSeries.test.ts`
Expected: FAIL — cannot resolve `./compareSeries`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/components/charts/compareSeries.ts
// Pure helpers for Phase-2 chart interactions.

// Union of every date across the daily sources, ascending and deduped. Both
// daily charts build their rows over this single axis so a shared <Brush> maps
// 1:1 (identical index → identical date on each chart).
export function dailyDateAxis(
  ...sources: ReadonlyArray<ReadonlyArray<{ date: string }>>
): string[] {
  const set = new Set<string>()
  for (const src of sources) for (const row of src) set.add(row.date)
  return [...set].sort()
}

// Overlay a previous-period series onto current rows positionally: prev[i] is
// written to rows[i][key]. Index alignment per the compare design — the earlier
// period is drawn on the current x-axis. Missing/extra entries become null; a
// real 0 is preserved (?? only replaces null/undefined).
export function overlayPrevious<T extends object>(
  rows: ReadonlyArray<T>,
  key: string,
  prev: ReadonlyArray<number | null>,
): Array<T & Record<string, number | null>> {
  return rows.map((row, i) => ({ ...row, [key]: prev[i] ?? null }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/renderer/src/components/charts/compareSeries.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/charts/compareSeries.ts src/renderer/src/components/charts/compareSeries.test.ts
git commit -m "feat(charts): add dailyDateAxis + overlayPrevious helpers"
```

---

## Task 4: shared brush styling constant

**Files:**
- Create: `src/renderer/src/components/charts/rangeBrush.ts`

No unit test — this is a styling constant + type (mirrors how `chartMeta` config is validated only by typecheck where it's trivial). Verified by `tsc`.

- [ ] **Step 1: Write the module**

```ts
// src/renderer/src/components/charts/rangeBrush.ts
// Shared <Brush> styling + range type. recharts can't detect a <Brush> wrapped
// in a custom component (it scans children by type), so each chart renders
// <Brush> inline and spreads these props for a consistent terminal look.

export interface BrushRange {
  startIndex?: number
  endIndex?: number
}

// Spread onto an inline recharts <Brush>. Date axis, short MM-DD traveller
// labels, hairline stroke, muted unselected fill, square (no-radius) travellers.
export const brushProps = {
  dataKey: 'date',
  height: 18,
  travellerWidth: 8,
  stroke: 'var(--color-chart-1)',
  fill: 'var(--color-muted)',
  tickFormatter: (v: string | number): string => String(v).slice(5),
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/charts/rangeBrush.ts
git commit -m "feat(charts): add shared brushProps for terminal-styled Brush"
```

---

## Task 5: unified daily axis + compare data in OverviewTab

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

Rebuild both daily memos over one shared axis and add the compare-period queries + overlay. This task is data-only; the chart JSX (brush/ghost) lands in Task 6.

- [ ] **Step 1: Update imports**

Change the recharts import block (lines 8–21) to add `Brush` and `ComposedChart` (used in Task 6; add now to keep imports in one edit):

```ts
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  XAxis,
  YAxis,
} from 'recharts'
```

Change the react import (line 7) to add `useEffect`:

```ts
import { type ReactNode, useEffect, useMemo, useState } from 'react'
```

Add the two new toolkit imports after the existing charts imports (after line 3):

```ts
import { dailyDateAxis, overlayPrevious } from '@renderer/components/charts/compareSeries'
import { brushProps, type BrushRange } from '@renderer/components/charts/rangeBrush'
```

- [ ] **Step 2: Add compare + brush state and the previous-period queries**

In `OverviewTab` (after line 467, the `kpi` query declaration), add:

```ts
  const [compare, setCompare] = useState(false)
  const [brushRange, setBrushRange] = useState<BrushRange>({})

  // Previous period = same window shifted back by `days`. Only fetched while
  // compare is on, so the toggle is the on/off switch for both ghost lines.
  const overviewPrev = trpc.productivity.overview.useQuery(
    { days, projectPath, offset: days },
    { enabled: compare },
  )
  const kpiPrev = trpc.productivity.kpi.useQuery(
    { days, projectPath, offset: days },
    { enabled: compare },
  )
```

- [ ] **Step 3: Replace the two chart-data memos with shared-axis versions**

Replace the entire `chartData` memo (lines 483–493) and `kpiChartData` memo (lines 497–508) with:

```ts
  // One ordered date axis shared by both daily charts so the lifted brush index
  // maps to the same day on each. Union of token days, kpi days, and eco days.
  const dailyDates = useMemo(
    () => dailyDateAxis(tokensByDay, kpi.data?.byDay ?? [], ecoDays.data ?? []),
    [tokensByDay, kpi.data, ecoDays.data],
  )

  // Tokens per day over the shared axis. When compare is on, overlay the
  // previous period's total tokens (in+out) positionally as `prevTokens`.
  const chartData = useMemo(() => {
    const tokMap = new Map(tokensByDay.map((d) => [d.date, d] as const))
    const ecoMap = new Map((ecoDays.data ?? []).map((e) => [e.date, e] as const))
    const base = dailyDates.map((date) => ({
      date,
      tokensIn: tokMap.get(date)?.tokensIn ?? 0,
      tokensOut: tokMap.get(date)?.tokensOut ?? 0,
      event: ecoMap.get(date)?.label ?? null,
      prevTokens: null as number | null,
    }))
    if (!compare) return base
    const prevTotals = (overviewPrev.data?.tokensByDay ?? []).map((d) => d.tokensIn + d.tokensOut)
    return overlayPrevious(base, 'prevTokens', prevTotals)
  }, [dailyDates, tokensByDay, ecoDays.data, compare, overviewPrev.data])

  // Eff per day over the shared axis. When compare is on, overlay the previous
  // period's Eff positionally as `prevKpi`. connectNulls bridges gap days.
  const kpiChartData = useMemo(() => {
    const ecoMap = new Map((ecoDays.data ?? []).map((e) => [e.date, e] as const))
    const kpiByDate = new Map((kpi.data?.byDay ?? []).map((d) => [d.date, d] as const))
    const base = dailyDates.map((date) => ({
      date,
      kpi: kpiByDate.get(date)?.kpi ?? null,
      quality: kpiByDate.get(date)?.quality ?? null,
      sessions: kpiByDate.get(date)?.sessions ?? 0,
      event: ecoMap.get(date)?.label ?? null,
      prevKpi: null as number | null,
    }))
    if (!compare) return base
    const prevKpis = (kpiPrev.data?.byDay ?? []).map((d) => d.kpi)
    return overlayPrevious(base, 'prevKpi', prevKpis)
  }, [dailyDates, kpi.data, ecoDays.data, compare, kpiPrev.data])

  // Reset the brush when the axis length changes (range toggle / project switch)
  // so stale indices can't point past the new data.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on length only
  useEffect(() => {
    setBrushRange({})
  }, [dailyDates.length])
```

> Note: `tokensByDay` is defined at line 477 (`overview.data?.tokensByDay ?? NO_TOKENS_BY_DAY`), above these memos — unchanged. The memos still run before the early returns, preserving hook order.

- [ ] **Step 4: Pass the new props into `DailyCharts`**

Replace the `<DailyCharts ... />` invocation (lines 675–685) with:

```tsx
        <DailyCharts
          chartData={chartData}
          kpiChartData={kpiChartData}
          eventDays={eventDays}
          tokensEmpty={tokensByDay.length === 0}
          kpiLoading={kpi.isLoading}
          kpiEmpty={(kpi.data?.byDay.length ?? 0) === 0}
          rebaseline={rebaseline}
          days={days}
          projectPath={projectPath}
          compare={compare}
          onToggleCompare={() => setCompare((v) => !v)}
          comparePending={compare && (overviewPrev.isFetching || kpiPrev.isFetching)}
          brushRange={brushRange}
          onBrushChange={setBrushRange}
        />
```

- [ ] **Step 5: Verify typecheck (expected to fail on DailyCharts props until Task 6)**

Run: `pnpm typecheck`
Expected: errors limited to `DailyCharts` missing the new props (`compare`, `onToggleCompare`, etc.) and the `prevTokens`/`prevKpi` fields — these are resolved in Task 6. Do NOT commit yet; Tasks 5 and 6 land together.

---

## Task 6: brush + ghost overlays + compare toggle in DailyCharts

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

- [ ] **Step 1: Extend the `DailyCharts` prop types**

In the `DailyCharts` destructured params (lines 249–275), add the new props to the destructure and the type. Change the row-type fields to include the prev keys, and add the new params:

```tsx
function DailyCharts({
  chartData,
  kpiChartData,
  eventDays,
  tokensEmpty,
  kpiLoading,
  kpiEmpty,
  rebaseline,
  days,
  projectPath,
  compare,
  onToggleCompare,
  comparePending,
  brushRange,
  onBrushChange,
}: {
  chartData: Array<{
    date: string
    tokensIn: number
    tokensOut: number
    event: string | null
    prevTokens: number | null
  }>
  kpiChartData: Array<{
    date: string
    kpi: number | null
    quality: number | null
    sessions: number
    event: string | null
    prevKpi: number | null
  }>
  eventDays: { date: string; count: number; label: string }[]
  tokensEmpty: boolean
  kpiLoading: boolean
  kpiEmpty: boolean
  rebaseline: ReturnType<typeof trpc.productivity.rebaseline.useMutation>
  days: number
  projectPath?: string
  compare: boolean
  onToggleCompare: () => void
  comparePending: boolean
  brushRange: BrushRange
  onBrushChange: (r: BrushRange) => void
}) {
```

- [ ] **Step 2: Add the brush onChange handler near the other handlers**

After `const onLeave = () => setActiveDate(null)` (line 279), add:

```tsx
  const onBrush = (r: { startIndex?: number; endIndex?: number }) =>
    onBrushChange({ startIndex: r.startIndex, endIndex: r.endIndex })
```

- [ ] **Step 3: Convert the tokens chart to ComposedChart + add ghost line, brush, and compare toggle**

In the TOKENS PER DAY `ChartFrame`, add a compare-toggle `action` and convert the chart. Change the frame opening (line 286) from:

```tsx
      <ChartFrame meta={tokensPerDayMeta} rows={chartData} format={tokenFmt}>
```

to:

```tsx
      <ChartFrame
        meta={tokensPerDayMeta}
        rows={chartData}
        format={tokenFmt}
        action={
          <button
            type="button"
            className={cn('btn', compare && 'primary')}
            onClick={onToggleCompare}
            disabled={comparePending}
            aria-pressed={compare}
          >
            ◧ COMPARE −{days}d
          </button>
        }
      >
```

Then change the chart element. Replace `<BarChart` (line 293) with `<ComposedChart` and its closing `</BarChart>` (line 341) with `</ComposedChart>`. Inside, after the two `<Bar>` blocks (after line 339, before `<EcoMarkers events={eventDays} />`), add the ghost line:

```tsx
                  {compare ? (
                    <Line
                      type="monotone"
                      dataKey="prevTokens"
                      stroke="var(--color-muted-foreground)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
```

And after `<EcoMarkers events={eventDays} />` (line 340), add the brush as the final child before `</ComposedChart>`:

```tsx
                  <Brush
                    {...brushProps}
                    startIndex={brushRange.startIndex}
                    endIndex={brushRange.endIndex}
                    onChange={onBrush}
                  />
```

- [ ] **Step 4: Add ghost line + brush to the Token Efficiency chart**

In the TOKEN EFFICIENCY `LineChart`, after the `quality` `<Line>` block (after line 448, before `<EcoMarkers events={eventDays} />` at line 449), add the ghost line (left/`kpi` axis, % units):

```tsx
                  {compare ? (
                    <Line
                      yAxisId="kpi"
                      type="monotone"
                      dataKey="prevKpi"
                      stroke="var(--color-muted-foreground)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
```

And after `<EcoMarkers events={eventDays} />` (line 449), add the brush as the final child before `</LineChart>`:

```tsx
                  <Brush
                    {...brushProps}
                    startIndex={brushRange.startIndex}
                    endIndex={brushRange.endIndex}
                    onChange={onBrush}
                  />
```

- [ ] **Step 5: Show the previous-period value in both tooltips**

In `TokensTooltip`, extend the payload type (line 109) to include `prevTokens`:

```tsx
  payload?: {
    payload: { tokensIn: number; tokensOut: number; event: string | null; prevTokens?: number | null }
  }[]
```

and add a row after the "Tokens out" block (after line 123, before the `row.event` block):

```tsx
      {row.prevTokens != null ? (
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">prev total</span>
          <span className="tabular-nums">{num(row.prevTokens)}</span>
        </div>
      ) : null}
```

In `KpiTooltip`, extend the payload type (lines 137–139) to include `prevKpi`:

```tsx
    payload: {
      kpi: number | null
      quality: number | null
      sessions: number
      event: string | null
      prevKpi?: number | null
    }
```

and add a row after the "Sessions" block (after line 157, before the `row.event` block):

```tsx
      {row.prevKpi != null ? (
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">prev Eff</span>
          <span className="tabular-nums">{`${row.prevKpi.toFixed(0)}%`}</span>
        </div>
      ) : null}
```

- [ ] **Step 6: Verify typecheck + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS. (If lint flags the `useEffect` exhaustive-deps from Task 5, the inline `biome-ignore` comment already covers it; confirm no other findings.)

- [ ] **Step 7: Commit Tasks 5 + 6 together**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(charts): shared brush zoom + compare-previous-period overlay on daily charts"
```

---

## Task 7: standalone brush on Stats events-per-day

**Files:**
- Modify: `src/renderer/src/pages/Stats.tsx`

- [ ] **Step 1: Add imports**

Change the recharts import (line 5) to add `Brush`:

```ts
import { Bar, BarChart, Brush, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
```

Add the brush props import after the existing charts imports (after line 2):

```ts
import { brushProps } from '@renderer/components/charts/rangeBrush'
```

- [ ] **Step 2: Add the brush as the last child of the BarChart**

After the `<Bar dataKey="count" ... />` line (line 144), before `</BarChart>` (line 145), add (uncontrolled — this chart is standalone, so no shared state):

```tsx
                  <Brush {...brushProps} />
```

- [ ] **Step 3: Verify typecheck + lint pass**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Stats.tsx
git commit -m "feat(charts): add range brush to Stats events-per-day chart"
```

---

## Task 8: full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm test`
Expected: all pass, including `window.test.ts` (4) and `compareSeries.test.ts` (6).

- [ ] **Step 2: Typecheck + lint the whole repo**

Run: `pnpm typecheck && pnpm lint`
Expected: both PASS.

- [ ] **Step 3: Manual app verification**

Run: `pnpm dev` (Electron). On the Productivity → overview tab:
- Drag either daily chart's brush travellers → **both** tokens-per-day and Token Efficiency zoom to the same date range together.
- Switch the range toggle (1d/7d/30d) or the project filter → the brush resets to full range (no stale/clipped zoom).
- Click `◧ COMPARE −Nd` → a dim dashed ghost line appears on **both** daily charts (previous period); the button shows its active/`primary` state; hovering a bar/point shows `prev total` / `prev Eff` in the tooltip. Toggle off → ghosts disappear.
- Crosshair sync + legend-chip toggles + `?` popover from Phase 1 still work.
- `⚑` ecosystem markers and the `y=100` reference line still paint.

On the Stats page:
- The events-per-day chart shows a brush; dragging it zooms that chart.

- [ ] **Step 4: Update project memory**

Update the memory file `charts-upgrade-phases.md` (via the memory workflow): mark Phase 2 DONE, note the unified daily axis + lifted brush + `offset`-param compare overlay, and that Phase 3 (`DayDrawer` drilldown) plus the today-by-hour HUD remain.

---

## Self-Review

**Spec coverage (Phase 2 section):**
- `RangeBrush` shared zoom on date charts → Tasks 4 (props), 5 (shared axis so indices align), 6 (lifted state + inline `<Brush>` on both daily charts). ✅
- Compare-previous-period: backend `offset` param → Tasks 1–2; ghost overlay on tokens-per-day + Token Efficiency → Tasks 5 (overlay data) + 6 (ghost `<Line>` + tooltips). ✅
- "Stats compare optional" → Stats gets the brush (Task 7); compare overlay intentionally deferred. ✅
- Risk noted in spec ("`<Brush>` styling + sharing across two charts") → addressed via `brushProps` + unified axis + lifted state; flagged for manual verify (Task 8). The recharts child-detection limitation is documented in Conventions. ✅

**Placeholder scan:** No TBD/“handle edge cases”/“similar to Task N”. Every code step shows full code. ✅

**Type consistency:** `windowBounds`/`TimeWindow` (Task 1) used in Task 2. `dailyDateAxis`/`overlayPrevious` (Task 3) used in Task 5. `brushProps`/`BrushRange` (Task 4) used in Tasks 5–7. Row fields `prevTokens`/`prevKpi` defined in Task 5 memos, typed in Task 6 props + read in Task 6 tooltips/ghost lines. `onBrush` handler shape `{startIndex?,endIndex?}` matches `BrushRange` and recharts `<Brush onChange>`. ✅
