# Charts Upgrade — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable `components/charts/` toolkit and apply it to all 4 charts, adding a self-explaining header (`//` caption + legend-chip toggles + `?` popover) and a synced crosshair + readout across the two date-axis charts — with zero backend changes.

**Architecture:** Pure config/logic lives in `.ts` files (unit-tested with vitest, node env). React UI lives in `.tsx` files (verified by strict `tsc` + manual app run; no testing-library in repo). `chartMeta.ts` is the single source of truth that drives caption, chips, and `?` popover. `HoverSyncContext` + recharts `syncId` give a crosshair shared by tokens-per-day and КПД; each chart shows the hovered day's values via `ChartReadout` in its frame header.

**Tech Stack:** React 19, recharts 3.8, TypeScript (strict), Tailwind v4 + CSS vars, vitest 4 (node), tRPC + react-query.

**Spec:** `docs/superpowers/specs/2026-05-24-charts-upgrade-design.md`

**Conventions (read before starting):**
- Tests colocate as `*.test.ts` next to source; run `pnpm test`. vitest only globs `.ts` (not `.tsx`) — keep tested logic in `.ts`.
- Aliases: `@renderer`, `@main`, `@shared`. Class merge helper: `cn` from `@renderer/lib/utils`.
- Terminal aesthetic: mono (`var(--mono)`), amber (`var(--amber)`, `var(--amber-dim)`), chart colors `var(--color-chart-1..5)`, hairlines `var(--color-border)`, no border-radius. Mirror existing panel/chart markup in `Productivity.tsx` and `Stats.tsx`.
- Keep the `EcoMarkers` component and `ReferenceLine y=100` exactly as-is (recharts v3 async-paint quirk — see project memory `recharts-v3-overlay-markers`).
- Ignore the `git-commit-message` skill if it triggers (wrong repo). Write normal commit messages.
- Pre-commit hook runs `pnpm lint && pnpm typecheck`; every commit must pass both.

---

## File Structure

| File | Type | Responsibility |
|---|---|---|
| `src/renderer/src/components/charts/chartMeta.ts` | pure | Types + per-chart metadata (series, caption, formula, syncGroup). |
| `src/renderer/src/components/charts/chartMeta.test.ts` | test | Validates metadata invariants. |
| `src/renderer/src/components/charts/hoverSync.ts` | pure | `hoverReducer` + types for shared crosshair state. |
| `src/renderer/src/components/charts/hoverSync.test.ts` | test | Reducer set/clear behavior. |
| `src/renderer/src/components/charts/HoverSyncContext.tsx` | component | Provider + `useHoverSync()` hook over `hoverReducer`. |
| `src/renderer/src/components/charts/InfoPopover.tsx` | component | `?` button → terminal-styled definition card; closes on Esc/outside. |
| `src/renderer/src/components/charts/LegendChips.tsx` | component | Series chips = visibility toggles; `title` = definition on hover. |
| `src/renderer/src/components/charts/ChartReadout.tsx` | component | Shows hovered day's series values for one chart (reads HoverSync). |
| `src/renderer/src/components/charts/ChartFrame.tsx` | component | Panel wrapper: header (title · caption · chips · `?` · readout) + body; owns hidden-series state. |
| `src/renderer/src/pages/Stats.tsx` | modify | events-per-day → ChartFrame. |
| `src/renderer/src/pages/Productivity.tsx` | modify | 3 charts → ChartFrame; wire syncId, readout, toggles, memo. |

---

## Task 1: chart metadata (pure + tested)

**Files:**
- Create: `src/renderer/src/components/charts/chartMeta.ts`
- Test: `src/renderer/src/components/charts/chartMeta.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// chartMeta.test.ts
import { describe, expect, it } from 'vitest'
import { CHART_METAS, kpiMeta, tokensPerDayMeta } from './chartMeta'

describe('chartMeta', () => {
  it('every chart has unique series keys and a color', () => {
    for (const meta of Object.values(CHART_METAS)) {
      const keys = meta.series.map((s) => s.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const s of meta.series) expect(s.color).toMatch(/^var\(/)
    }
  })

  it('КПД chart exposes a formula for the ? popover', () => {
    expect(kpiMeta.formula).toBeDefined()
    expect(kpiMeta.formula?.body).toMatch(/baseline/i)
  })

  it('the two daily charts share a sync group', () => {
    expect(tokensPerDayMeta.syncGroup).toBeDefined()
    expect(kpiMeta.syncGroup).toBe(tokensPerDayMeta.syncGroup)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm test -- chartMeta`
Expected: FAIL — cannot find module `./chartMeta`.

- [ ] **Step 3: Implement `chartMeta.ts`**

```ts
// Single source of truth for every chart's header: which series exist, what
// they mean, the metric formula (for the ? popover), and whether the chart
// participates in the synced crosshair group.

export interface SeriesDef {
  key: string // dataKey on the chart row
  label: string // chip text, e.g. 'in'
  color: string // CSS var, e.g. 'var(--color-chart-1)'
  definition: string // shown on chip hover (title)
  axis?: 'left' | 'right' // dual-axis charts only
  dashed?: boolean // rendered as a dashed line (e.g. quality)
}

export interface ChartMeta {
  id: string
  title: string
  caption: string // the // line under the title
  series: SeriesDef[]
  formula?: { label: string; body: string } // ? popover content
  syncGroup?: string // shared recharts syncId; omit for standalone charts
}

const DAILY_SYNC = 'productivity-daily'

export const tokensPerDayMeta: ChartMeta = {
  id: 'tokens-per-day',
  title: 'tokens per day',
  caption: 'input + output tokens per day · ⚑ = ecosystem change',
  syncGroup: DAILY_SYNC,
  series: [
    { key: 'tokensIn', label: 'in', color: 'var(--color-chart-1)', definition: 'prompt tokens sent to the model' },
    { key: 'tokensOut', label: 'out', color: 'var(--color-chart-2)', definition: 'tokens generated by the model' },
  ],
}

export const kpiMeta: ChartMeta = {
  id: 'kpi',
  title: 'КПД · efficiency',
  caption: 'КПД vs frozen baseline · 100% = baseline · ⚑ = ecosystem change',
  syncGroup: DAILY_SYNC,
  formula: {
    label: 'КПД',
    body: 'КПД = expected ÷ actual tokens × 100, vs a frozen baseline. 100% = on baseline; higher = more efficient (fewer tokens than expected for the task difficulty).',
  },
  series: [
    { key: 'kpi', label: 'КПД', color: 'var(--color-chart-1)', definition: 'efficiency % vs frozen baseline', axis: 'left' },
    { key: 'quality', label: 'quality', color: 'var(--color-chart-2)', definition: 'avg user rating 0–10 (rated sessions only)', axis: 'right', dashed: true },
  ],
}

export const todayByHourMeta: ChartMeta = {
  id: 'today-by-hour',
  title: 'today by hour',
  caption: 'current local day · ignores the range above',
  series: [
    { key: 'tokensIn', label: 'in', color: 'var(--color-chart-1)', definition: 'prompt tokens sent to the model' },
    { key: 'tokensOut', label: 'out', color: 'var(--color-chart-2)', definition: 'tokens generated by the model' },
  ],
}

export const eventsPerDayMeta: ChartMeta = {
  id: 'events-per-day',
  title: 'events per day',
  caption: 'agent runs per day · last 30 days',
  series: [{ key: 'count', label: 'events', color: 'var(--color-chart-1)', definition: 'number of agent runs that day' }],
}

export const CHART_METAS: Record<string, ChartMeta> = {
  [tokensPerDayMeta.id]: tokensPerDayMeta,
  [kpiMeta.id]: kpiMeta,
  [todayByHourMeta.id]: todayByHourMeta,
  [eventsPerDayMeta.id]: eventsPerDayMeta,
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm test -- chartMeta`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/charts/chartMeta.ts src/renderer/src/components/charts/chartMeta.test.ts
git commit -m "feat(charts): chart metadata source of truth"
```

---

## Task 2: hover-sync reducer + context

**Files:**
- Create: `src/renderer/src/components/charts/hoverSync.ts`
- Test: `src/renderer/src/components/charts/hoverSync.test.ts`
- Create: `src/renderer/src/components/charts/HoverSyncContext.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// hoverSync.test.ts
import { describe, expect, it } from 'vitest'
import { hoverReducer, initialHover } from './hoverSync'

describe('hoverReducer', () => {
  it('sets the active date', () => {
    expect(hoverReducer(initialHover, { type: 'set', date: '2026-05-18' })).toEqual({
      activeDate: '2026-05-18',
    })
  })

  it('clears the active date', () => {
    const active = { activeDate: '2026-05-18' }
    expect(hoverReducer(active, { type: 'clear' })).toEqual({ activeDate: null })
  })

  it('ignores an unknown action', () => {
    const state = { activeDate: '2026-05-18' }
    // @ts-expect-error unknown action type
    expect(hoverReducer(state, { type: 'noop' })).toBe(state)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm test -- hoverSync`
Expected: FAIL — cannot find module `./hoverSync`.

- [ ] **Step 3: Implement `hoverSync.ts`**

```ts
// Shared crosshair state for charts in the same sync group. The active date is
// the x-axis category currently hovered on any synced chart; each chart reads it
// to render a matching readout.
export interface HoverState {
  activeDate: string | null
}

export type HoverAction = { type: 'set'; date: string | null } | { type: 'clear' }

export const initialHover: HoverState = { activeDate: null }

export function hoverReducer(state: HoverState, action: HoverAction): HoverState {
  switch (action.type) {
    case 'set':
      return state.activeDate === action.date ? state : { activeDate: action.date }
    case 'clear':
      return state.activeDate === null ? state : { activeDate: null }
    default:
      return state
  }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm test -- hoverSync`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `HoverSyncContext.tsx`**

```tsx
import { createContext, type ReactNode, useContext, useMemo, useReducer } from 'react'
import { hoverReducer, initialHover } from './hoverSync'

interface HoverSyncValue {
  activeDate: string | null
  setActiveDate: (date: string | null) => void
}

const HoverSyncCtx = createContext<HoverSyncValue | null>(null)

export function HoverSyncProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(hoverReducer, initialHover)
  const value = useMemo<HoverSyncValue>(
    () => ({
      activeDate: state.activeDate,
      setActiveDate: (date) => dispatch(date == null ? { type: 'clear' } : { type: 'set', date }),
    }),
    [state.activeDate],
  )
  return <HoverSyncCtx.Provider value={value}>{children}</HoverSyncCtx.Provider>
}

// Safe outside a provider: standalone charts get an inert no-op.
export function useHoverSync(): HoverSyncValue {
  return useContext(HoverSyncCtx) ?? { activeDate: null, setActiveDate: () => {} }
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck:web`
Expected: no errors.

```bash
git add src/renderer/src/components/charts/hoverSync.ts src/renderer/src/components/charts/hoverSync.test.ts src/renderer/src/components/charts/HoverSyncContext.tsx
git commit -m "feat(charts): hover-sync reducer + context"
```

---

## Task 3: InfoPopover (`?` primitive)

**Files:**
- Create: `src/renderer/src/components/charts/InfoPopover.tsx`

- [ ] **Step 1: Implement `InfoPopover.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'

// Small "?" affixed to a chart title. Click toggles a terminal-styled card with
// the metric definition. Closes on Escape or outside-click. No external dep.
export function InfoPopover({ label, body }: { label: string; body: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label={`What is ${label}?`}
        onClick={() => setOpen((v) => !v)}
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          lineHeight: '14px',
          width: 16,
          height: 16,
          border: '1px solid var(--color-border)',
          color: open ? 'var(--amber)' : 'var(--fg-4)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        ?
      </button>
      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 20,
            left: 0,
            zIndex: 10,
            width: 240,
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            padding: '8px 10px',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--color-popover-foreground)',
          }}
        >
          <div style={{ color: 'var(--amber)', marginBottom: 4 }}>{label}</div>
          <div style={{ color: 'var(--fg-3)' }}>{body}</div>
        </div>
      ) : null}
    </span>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck:web`
Expected: no errors.

```bash
git add src/renderer/src/components/charts/InfoPopover.tsx
git commit -m "feat(charts): InfoPopover ? primitive"
```

---

## Task 4: LegendChips (series toggles)

**Files:**
- Create: `src/renderer/src/components/charts/LegendChips.tsx`

- [ ] **Step 1: Implement `LegendChips.tsx`**

```tsx
import type { SeriesDef } from './chartMeta'

// Series chips that double as visibility toggles. A chip in `hidden` renders
// struck-through and dim. Hover shows the series definition (native title).
export function LegendChips({
  series,
  hidden,
  onToggle,
}: {
  series: SeriesDef[]
  hidden: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {series.map((s) => {
        const off = hidden.has(s.key)
        return (
          <button
            key={s.key}
            type="button"
            title={s.definition}
            onClick={() => onToggle(s.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--mono)',
              fontSize: 10,
              padding: '1px 6px',
              border: `1px solid ${off ? 'var(--color-border)' : s.color}`,
              color: off ? 'var(--fg-4)' : s.color,
              background: 'transparent',
              cursor: 'pointer',
              textDecoration: off ? 'line-through' : 'none',
            }}
          >
            <span aria-hidden style={{ width: 8, height: 8, background: off ? 'transparent' : s.color, border: `1px solid ${s.color}` }} />
            {s.label}
          </button>
        )
      })}
    </span>
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm typecheck:web`
Expected: no errors.

```bash
git add src/renderer/src/components/charts/LegendChips.tsx
git commit -m "feat(charts): LegendChips toggle row"
```

---

## Task 5: ChartReadout + ChartFrame

**Files:**
- Create: `src/renderer/src/components/charts/ChartReadout.tsx`
- Create: `src/renderer/src/components/charts/ChartFrame.tsx`

- [ ] **Step 1: Implement `ChartReadout.tsx`**

```tsx
import type { ChartMeta } from './chartMeta'
import { useHoverSync } from './HoverSyncContext'

// Renders the hovered day's values for one chart's series, driven by the shared
// active date. `rows` is the chart's data; `format` turns a raw value into text.
export function ChartReadout({
  meta,
  rows,
  hidden,
  format,
}: {
  meta: ChartMeta
  rows: Array<Record<string, unknown>>
  hidden: ReadonlySet<string>
  format?: (key: string, value: number) => string
}) {
  const { activeDate } = useHoverSync()
  if (!activeDate) return null
  const row = rows.find((r) => r.date === activeDate)
  if (!row) return null
  const fmt = format ?? ((_k, v) => String(v))
  return (
    <span style={{ display: 'inline-flex', gap: 12, fontFamily: 'var(--mono)', fontSize: 11 }}>
      <span style={{ color: 'var(--amber)' }}>{activeDate.slice(5)}</span>
      {meta.series
        .filter((s) => !hidden.has(s.key))
        .map((s) => {
          const v = row[s.key]
          return (
            <span key={s.key} style={{ color: 'var(--fg-4)' }}>
              {s.label}{' '}
              <span style={{ color: 'var(--fg-2)' }}>
                {v == null ? '—' : fmt(s.key, Number(v))}
              </span>
            </span>
          )
        })}
    </span>
  )
}
```

- [ ] **Step 2: Implement `ChartFrame.tsx`**

```tsx
import { type ReactNode, useCallback, useState } from 'react'
import type { ChartMeta } from './chartMeta'
import { ChartReadout } from './ChartReadout'
import { InfoPopover } from './InfoPopover'
import { LegendChips } from './LegendChips'

// Reusable chart panel. Header carries the title, // caption, legend-chip
// toggles, an optional ? popover, and (when rows are passed) a synced readout.
// Body renders the chart via a render-prop that receives the hidden-series set.
export function ChartFrame({
  meta,
  rows,
  format,
  action,
  children,
}: {
  meta: ChartMeta
  rows?: Array<Record<string, unknown>>
  format?: (key: string, value: number) => string
  action?: ReactNode
  children: (hidden: ReadonlySet<string>) => ReactNode
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }, [])

  return (
    <div className="panel mt-16">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="ttl" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {meta.title}
          {meta.formula ? <InfoPopover label={meta.formula.label} body={meta.formula.body} /> : null}
        </span>
        {meta.series.length > 1 ? (
          <LegendChips series={meta.series} hidden={hidden} onToggle={toggle} />
        ) : null}
        {rows ? <ChartReadout meta={meta} rows={rows} hidden={hidden} format={format} /> : null}
        {action}
      </div>
      <div className="panel-body">
        <div
          style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)', marginBottom: 8 }}
        >
          <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
          {meta.caption}
        </div>
        {children(hidden)}
      </div>
    </div>
  )
}
```

> Note: biome may flag the ternary side-effect in `toggle`. If lint complains, rewrite as an `if/else` block.

- [ ] **Step 3: Typecheck + lint + commit**

Run: `pnpm typecheck:web && pnpm lint`
Expected: no errors.

```bash
git add src/renderer/src/components/charts/ChartReadout.tsx src/renderer/src/components/charts/ChartFrame.tsx
git commit -m "feat(charts): ChartFrame + ChartReadout"
```

---

## Task 6: Apply ChartFrame to Stats events-per-day

**Files:**
- Modify: `src/renderer/src/pages/Stats.tsx`

Proves the pattern on the simplest chart (single series, standalone).

- [ ] **Step 1: Wrap the chart in ChartFrame**

Replace the `<div className="panel mt-20">…events per day…</div>` block (lines ~108-151) with a `ChartFrame`. Import `ChartFrame` and `eventsPerDayMeta`. Keep the existing `BarChart`/axes/`Tooltip`/`Bar` markup as the `children`, but drop the hand-written `panel-head`/`meta` (the frame supplies title + caption). Conditionally render the `count` Bar based on `hidden` (single series, so optional). Pass `rows={data}` and `format={(_k, v) => String(v)}` for the readout. Add `onMouseMove`/`onMouseLeave` later only if Stats joins a sync group — for now standalone, so the readout shows nothing (no provider); that's fine.

```tsx
import { ChartFrame } from '@renderer/components/charts/ChartFrame'
import { eventsPerDayMeta } from '@renderer/components/charts/chartMeta'
// …
<ChartFrame meta={eventsPerDayMeta}>
  {() => (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
          {/* keep existing CartesianGrid / XAxis / YAxis / Tooltip / Bar exactly */}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )}
</ChartFrame>
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck:web && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Manual check**

Run: `pnpm dev`. Open Stats (page 02). Confirm: title "events per day", `//` caption line, chart renders, no console errors. Stop dev.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Stats.tsx
git commit -m "feat(charts): Stats events-per-day uses ChartFrame"
```

---

## Task 7: Apply ChartFrame to today-by-hour

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

- [ ] **Step 1: Wrap today-by-hour in ChartFrame**

Import `ChartFrame` and `todayByHourMeta`. Replace the `{/* TODAY BY HOUR */}` panel header with `ChartFrame meta={todayByHourMeta}`. Keep the inline totals strip and the `BarChart` as children. Use the render-prop `hidden` to drop a `Bar` when its series key is hidden:

```tsx
{(hidden) => (
  <>
    {/* totals strip unchanged */}
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={today.data.hours} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
          {/* grid / axes / Tooltip unchanged */}
          {!hidden.has('tokensIn') ? <Bar dataKey="tokensIn" stackId="t" fill="var(--color-chart-1)" /> : null}
          {!hidden.has('tokensOut') ? <Bar dataKey="tokensOut" stackId="t" fill="var(--color-chart-2)" /> : null}
        </BarChart>
      </ResponsiveContainer>
    </div>
  </>
)}
```

Keep the existing loading / "no activity yet today" guards outside the chart body (or inside the render-prop before the chart). The caption from meta replaces the old `meta` span.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck:web && pnpm lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(charts): today-by-hour uses ChartFrame + series toggles"
```

---

## Task 8: tokens-per-day + КПД — frame, synced crosshair, readout, memo

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

This is the headline task: both daily charts share a crosshair and each shows the hovered day's readout.

- [ ] **Step 1: Wrap the OverviewTab daily charts in a HoverSyncProvider**

Import `HoverSyncProvider`, `useHoverSync`, `ChartFrame`, `tokensPerDayMeta`, `kpiMeta`. Wrap the two daily panels (tokens-per-day + КПД) in `<HoverSyncProvider>`.

- [ ] **Step 2: Memoize chart data**

Wrap `chartData` and `kpiChartData` (lines ~276-297) in `useMemo`:

```tsx
const chartData = useMemo(() => {
  const ecoMap = new Map((ecoDays.data ?? []).map((e) => [e.date, e] as const))
  const tokMap = new Map(tokensByDay.map((d) => [d.date, d] as const))
  const allDates = [...new Set([...tokMap.keys(), ...ecoMap.keys()])].sort()
  return allDates.map((date) => ({
    date,
    tokensIn: tokMap.get(date)?.tokensIn ?? 0,
    tokensOut: tokMap.get(date)?.tokensOut ?? 0,
    event: ecoMap.get(date)?.label ?? null,
  }))
}, [ecoDays.data, tokensByDay])

const kpiChartData = useMemo(() => {
  const ecoMap = new Map((ecoDays.data ?? []).map((e) => [e.date, e] as const))
  const kpiByDate = new Map((kpi.data?.byDay ?? []).map((d) => [d.date, d] as const))
  const kpiDates = [...new Set([...kpiByDate.keys(), ...ecoMap.keys()])].sort()
  return kpiDates.map((date) => ({
    date,
    kpi: kpiByDate.get(date)?.kpi ?? null,
    quality: kpiByDate.get(date)?.quality ?? null,
    sessions: kpiByDate.get(date)?.sessions ?? 0,
    event: ecoMap.get(date)?.label ?? null,
  }))
}, [ecoDays.data, kpi.data])
```

Add `import { useMemo } from 'react'`.

- [ ] **Step 3: Wire syncId + hover handlers on both charts**

Both `BarChart` (tokens) and `LineChart` (КПД) get `syncId={tokensPerDayMeta.syncGroup}` and hover handlers that publish the active date. Because the handlers need the provider, extract the two charts into a small inner component (e.g. `DailyCharts`) rendered inside `HoverSyncProvider`, or read `useHoverSync()` in `OverviewTab` (OverviewTab itself must then be inside the provider). Simplest: create an inner `DailyCharts` component:

```tsx
function DailyCharts({ chartData, kpiChartData, eventDays, rebaseline, days, projectPath }: {
  chartData: Array<{ date: string; tokensIn: number; tokensOut: number; event: string | null }>
  kpiChartData: Array<{ date: string; kpi: number | null; quality: number | null; sessions: number; event: string | null }>
  eventDays: { date: string; count: number; label: string }[]
  rebaseline: ReturnType<typeof trpc.productivity.rebaseline.useMutation>
  days: number
  projectPath?: string
}) {
  const { setActiveDate } = useHoverSync()
  const onMove = (s: { activeLabel?: string | number }) => setActiveDate(s?.activeLabel != null ? String(s.activeLabel) : null)
  const onLeave = () => setActiveDate(null)
  const tokenFmt = (_k: string, v: number) => num(v)
  const kpiFmt = (k: string, v: number) => (k === 'kpi' ? `${v.toFixed(0)}%` : v.toFixed(1))
  // …render tokens ChartFrame then КПД ChartFrame (see steps 4-5)
}
```

`onMouseMove`/`onMouseLeave` go on each chart: `<BarChart … syncId={tokensPerDayMeta.syncGroup} onMouseMove={onMove} onMouseLeave={onLeave}>`. recharts passes a state object whose `activeLabel` is the hovered category.

- [ ] **Step 4: tokens-per-day via ChartFrame**

```tsx
<ChartFrame meta={tokensPerDayMeta} rows={chartData} format={tokenFmt}>
  {(hidden) => (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} syncId={tokensPerDayMeta.syncGroup} onMouseMove={onMove} onMouseLeave={onLeave} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
          {/* grid / XAxis / YAxis / <Tooltip content={<TokensTooltip />}/> unchanged */}
          {!hidden.has('tokensIn') ? <Bar dataKey="tokensIn" stackId="t" fill="var(--color-chart-1)" radius={[0,0,0,0]} /> : null}
          {!hidden.has('tokensOut') ? <Bar dataKey="tokensOut" stackId="t" fill="var(--color-chart-2)" radius={[0,0,0,0]} /> : null}
          <EcoMarkers events={eventDays} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )}
</ChartFrame>
```

- [ ] **Step 5: КПД via ChartFrame**

Keep the RE-BASELINE button by passing it as `action`. Keep `ReferenceLine y=100` and `EcoMarkers`. Toggle the two `Line`s by `hidden`.

```tsx
<ChartFrame meta={kpiMeta} rows={kpiChartData} format={kpiFmt} action={
  <button type="button" className="btn" disabled={rebaseline.isPending} onClick={() => rebaseline.mutate({ projectPath, start: new Date(Date.now() - days*24*60*60*1000), end: new Date() })}>↻ RE-BASELINE ({days}d)</button>
}>
  {(hidden) => (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={kpiChartData} syncId={tokensPerDayMeta.syncGroup} onMouseMove={onMove} onMouseLeave={onLeave} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
          {/* grid / XAxis / both YAxis / ReferenceLine y=100 / <Tooltip content={<KpiTooltip/>}/> unchanged */}
          {!hidden.has('kpi') ? <Line yAxisId="kpi" type="monotone" dataKey="kpi" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} /> : null}
          {!hidden.has('quality') ? <Line yAxisId="quality" type="monotone" dataKey="quality" stroke="var(--color-chart-2)" strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} /> : null}
          <EcoMarkers events={eventDays} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )}
</ChartFrame>
```

Render `<DailyCharts … />` inside `<HoverSyncProvider>` where the two panels used to be, passing the memoized data, `eventDays`, `rebaseline`, `days`, `projectPath`.

- [ ] **Step 6: Verify**

Run: `pnpm typecheck:web && pnpm lint && pnpm test`
Expected: no errors; all unit tests pass.

- [ ] **Step 7: Manual check**

Run: `pnpm dev`. Productivity → overview. Confirm: both daily charts show title/caption/chips; КПД shows `?` with the formula; toggling a chip hides/shows its series; hovering one daily chart moves the crosshair on the other AND updates both readouts to the same date; ⚑ markers and the 100% line still paint. Stop dev.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(charts): synced crosshair + readout + toggles for daily charts"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all green.

- [ ] **Step 2: Manual sweep**

Run: `pnpm dev`. Visit Stats + Productivity/overview. Verify all 4 charts: caption present, chips toggle (where multi-series), КПД `?` popover opens/closes (Esc + outside-click), synced crosshair + readout on the two daily charts, eco markers + 100% line intact, no console errors. Stop dev.

- [ ] **Step 3: Confirm Phase 1 done**

All boxes checked, gate green, manual sweep clean. Phase 2 (brush + compare) and Phase 3 (drilldown drawer) get their own plans next.

---

## Self-Review

- **Spec coverage (Phase 1 rows):** caption ✓(Task 5 frame body) · legend chips/toggles ✓(Tasks 4,7,8) · `?` popover ✓(Tasks 3,8) · synced crosshair ✓(Task 8 syncId) · readout HUD ✓(Tasks 5,8) · useMemo perf ✓(Task 8) · keep EcoMarkers/ReferenceLine ✓(Tasks 8). Brush/compare/drawer are explicitly Phase 2/3, not this plan.
- **Placeholder scan:** none — every component has full code; integration steps reference exact existing markup to preserve.
- **Type consistency:** `ChartMeta`/`SeriesDef` (Task 1) used by LegendChips, ChartReadout, ChartFrame; `hoverReducer`/`HoverState` (Task 2) used by HoverSyncContext; `useHoverSync` (Task 2) used by ChartReadout + DailyCharts (Task 8); `syncGroup` string shared via `tokensPerDayMeta.syncGroup`. Consistent.
