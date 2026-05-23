# KPI (Efficiency) Metric + Chart — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a KPI (efficiency) metric — `(score ?? 5.5) × complexity / (tokens/1M)` — to the Productivity page: a per-day line chart with ecosystem-change markers, a metric card, a Sessions column, and before/after KPI in the Change-impact table.

**Architecture:** Pure KPI math lives in `src/shared/kpi.ts` (imported by the tRPC router in main, the renderer page, and vitest — DRY across processes). KPI is computed at read time (like complexity); no DB schema change. The router gains a `kpi` procedure and KPI fields on `ecosystemImpact`. The renderer reuses the existing `EcoMarkers` overlay and chart patterns.

**Tech Stack:** Electron + tRPC + Drizzle (better-sqlite3) in main; React + Recharts 3.8.1 in renderer; Vitest (node env, `@shared`/`@main`/`@renderer` aliases) for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-23-kpd-efficiency-metric-design.md`

**Pre-flight (execution):** Work in a branch/worktree off `main` (see superpowers:using-git-worktrees). The tree currently has unrelated in-progress changes (`skills.ts`, `Skills.tsx`, `PageHeader.tsx`, `index.css`, `shared/skills.ts`, `skills.test.ts`) — every commit step below uses **scoped `git add <files>`**, never `git add -A`, so those stay untouched.

**Reference — definitions reused below:**
- `kpiWindow(sessions)` = `Σ(q×complexity) / (Σtokens/1e6)`, `q = score ?? 5.5`, skipping sessions with `complexity == null` or `tokens <= 0`; `null` if no usable tokens.
- `kpiByDay(sessions)` groups by `session.day` then applies `kpiWindow` per group.
- `kpiSession(score, complexity, tokens)` = `kpiWindow` of one session.

---

### Task 1: Pure KPI helper (`src/shared/kpi.ts`) — TDD

**Files:**
- Create: `src/shared/kpi.ts`
- Test: `src/shared/kpi.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/kpi.test.ts`:

```ts
import { kpiByDay, kpiSession, kpiWindow, UNRATED_SCORE } from '@shared/kpi'
import { describe, expect, it } from 'vitest'

describe('UNRATED_SCORE', () => {
  it('is the 1–10 scale midpoint', () => {
    expect(UNRATED_SCORE).toBe(5.5)
  })
})

describe('kpiSession', () => {
  it('computes (score × complexity) per 1M tokens', () => {
    // 9 × 7 / (1_000_000 / 1e6) = 63
    expect(kpiSession(9, 7, 1_000_000)).toBe(63)
  })

  it('imputes 5.5 for an unrated session', () => {
    // 5.5 × 4 / (2_000_000 / 1e6) = 22 / 2 = 11
    expect(kpiSession(null, 4, 2_000_000)).toBe(11)
  })

  it('returns null when complexity is null', () => {
    expect(kpiSession(8, null, 1_000_000)).toBeNull()
  })

  it('returns null when tokens are zero or negative', () => {
    expect(kpiSession(8, 5, 0)).toBeNull()
    expect(kpiSession(8, 5, -10)).toBeNull()
  })
})

describe('kpiWindow', () => {
  it('is token-weighted: a heavy session drags the window down', () => {
    // light: q5.5×comp8 on 0.1M ; heavy: q5.5×comp2 on 10M
    // Σqc = 44 + 11 = 55 ; Σtok = 10_100_000 ; kpi = 55 / 10.1 ≈ 5.4455
    const v = kpiWindow([
      { score: null, complexity: 8, tokens: 100_000 },
      { score: null, complexity: 2, tokens: 10_000_000 },
    ])
    expect(v).toBeCloseTo(55 / 10.1, 6)
  })

  it('skips unusable sessions (null complexity / zero tokens)', () => {
    // only the valid 5.5×6 on 1M counts -> 33
    const v = kpiWindow([
      { score: null, complexity: 6, tokens: 1_000_000 },
      { score: 9, complexity: null, tokens: 5_000_000 },
      { score: 9, complexity: 9, tokens: 0 },
    ])
    expect(v).toBe(33)
  })

  it('returns null for an empty / fully-unusable window', () => {
    expect(kpiWindow([])).toBeNull()
    expect(kpiWindow([{ score: 9, complexity: null, tokens: 0 }])).toBeNull()
  })
})

describe('kpiByDay', () => {
  it('groups by day, token-weights within a day, sorts by date', () => {
    const out = kpiByDay([
      { day: '2026-05-02', score: null, complexity: 6, tokens: 1_000_000 },
      { day: '2026-05-01', score: 10, complexity: 5, tokens: 1_000_000 },
      { day: '2026-05-01', score: null, complexity: 5, tokens: 1_000_000 },
    ])
    expect(out.map((d) => d.date)).toEqual(['2026-05-01', '2026-05-02'])
    // 2026-05-01: (10×5 + 5.5×5) / 2 = 77.5 / 2 = 38.75 ; sessions 2 ; tokens 2_000_000
    expect(out[0]).toEqual({ date: '2026-05-01', kpi: 38.75, sessions: 2, tokens: 2_000_000 })
    // 2026-05-02: 5.5×6 / 1 = 33
    expect(out[1]).toEqual({ date: '2026-05-02', kpi: 33, sessions: 1, tokens: 1_000_000 })
  })

  it('drops days whose sessions are all unusable', () => {
    const out = kpiByDay([{ day: '2026-05-01', score: 9, complexity: null, tokens: 0 }])
    expect(out).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/shared/kpi.test.ts`
Expected: FAIL — cannot resolve `@shared/kpi` / exports not defined.

- [ ] **Step 3: Write minimal implementation**

Create `src/shared/kpi.ts`:

```ts
// KPI = efficiency: useful output (quality × complexity) per token spent.
// Pure math, shared by the tRPC router (main), the Productivity page (renderer),
// and unit tests. See docs/superpowers/specs/2026-05-23-kpd-efficiency-metric-design.md

/** Imputed quality for sessions the user has not rated (1–10 scale midpoint). */
export const UNRATED_SCORE = 5.5

/** Minimal per-session shape KPI needs. `score` null = unrated. */
export interface KpiInput {
  score: number | null
  complexity: number | null
  tokens: number
}

/** A KPI input tagged with the local calendar day it belongs to (YYYY-MM-DD). */
export interface KpiSession extends KpiInput {
  day: string
}

const usable = (s: KpiInput): boolean => s.complexity != null && s.tokens > 0
const quality = (score: number | null): number => score ?? UNRATED_SCORE

// Token-weighted KPI over a set of sessions: Σ(q × complexity) / (Σ tokens / 1M).
// q = score ?? 5.5. Skips sessions with null complexity or non-positive tokens.
// Returns null when no usable tokens remain.
export function kpiWindow(sessions: KpiInput[]): number | null {
  let sumQC = 0
  let sumTok = 0
  for (const s of sessions) {
    if (!usable(s)) continue
    sumQC += quality(s.score) * (s.complexity as number)
    sumTok += s.tokens
  }
  return sumTok > 0 ? sumQC / (sumTok / 1_000_000) : null
}

/** KPI of a single session (null if not computable). */
export function kpiSession(
  score: number | null,
  complexity: number | null,
  tokens: number,
): number | null {
  return kpiWindow([{ score, complexity, tokens }])
}

export interface KpiDay {
  date: string
  kpi: number
  sessions: number
  tokens: number
}

// Group sessions by day, token-weight KPI within each day, sort ascending by date.
// Days whose sessions are all unusable are dropped.
export function kpiByDay(sessions: KpiSession[]): KpiDay[] {
  const byDay = new Map<string, KpiSession[]>()
  for (const s of sessions) {
    const arr = byDay.get(s.day) ?? []
    arr.push(s)
    byDay.set(s.day, arr)
  }
  const out: KpiDay[] = []
  for (const [date, list] of byDay) {
    const kpi = kpiWindow(list)
    if (kpi == null) continue
    const used = list.filter(usable)
    out.push({
      date,
      kpi,
      sessions: used.length,
      tokens: used.reduce((t, s) => t + s.tokens, 0),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/shared/kpi.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/shared/kpi.ts src/shared/kpi.test.ts
git commit -m "feat(productivity): pure KPI efficiency helper"
```

---

### Task 2: `kpi` tRPC procedure (backend)

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts` (imports + new procedure after `overview`)

> Not unit-tested: the tRPC layer needs the Electron-ABI `better-sqlite3` DB, which can't load under vitest (see the productivity ingest split). Math is covered by Task 1; this task is verified by typecheck + build.

- [ ] **Step 1: Add the shared KPI import**

In `src/main/trpc/routers/productivity.ts`, add after the existing `complexity` import (line ~5):

```ts
import { type KpiSession, kpiByDay, kpiWindow } from '@shared/kpi'
```

- [ ] **Step 2: Add the `kpi` procedure**

Insert immediately after the `overview` procedure block closes (after its `}),` at line ~285), before `today`:

```ts
  // Efficiency KPI per day + overall, scoped by window + optional project.
  // KPI = (score ?? 5.5) × complexity / (tokens / 1M), token-weighted per day.
  // Each session is bucketed on its last-turn local day so day keys align with
  // tokensByDay / ecosystemDays (the EcoMarkers overlay relies on that).
  kpi: publicProcedure
    .input(rangeInput)
    .output(
      z.object({
        byDay: z.array(
          z.object({
            date: z.string(),
            kpi: z.number(),
            sessions: z.number(),
            tokens: z.number(),
          }),
        ),
        overall: z.number().nullable(),
      }),
    )
    .query(({ input }) => {
      const scoped = turnFilter(cutoffDate(input.days), input.projectPath)

      // Each session's last-turn local day, within window + scope.
      const day = sql<string>`date(max(${agentTurns.ts}) / 1000, 'unixepoch', 'localtime')`
      const dayRows = db()
        .select({ id: agentTurns.sessionId, day })
        .from(agentTurns)
        .where(scoped)
        .groupBy(agentTurns.sessionId)
        .all()
      if (dayRows.length === 0) return { byDay: [], overall: null }
      const dayById = new Map(dayRows.map((r) => [r.id, r.day]))

      const windowSessionIds = db()
        .select({ id: agentTurns.sessionId })
        .from(agentTurns)
        .where(scoped)
      const sessRows = db()
        .select({
          id: agentSessions.sessionId,
          score: agentSessions.score,
          tin: agentSessions.totalTokensIn,
          tout: agentSessions.totalTokensOut,
        })
        .from(agentSessions)
        .where(inArray(agentSessions.sessionId, windowSessionIds))
        .all()

      const cmap = sessionComplexityMap()
      const sessions: KpiSession[] = sessRows.map((r) => ({
        day: dayById.get(r.id) ?? '',
        score: r.score,
        complexity: cmap.get(r.id)?.complexity ?? null,
        tokens: r.tin + r.tout,
      }))

      return { byDay: kpiByDay(sessions), overall: kpiWindow(sessions) }
    }),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no type errors; `kpi` output matches schema).

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(productivity): kpi tRPC procedure (per-day + overall efficiency)"
```

---

### Task 3: KPI before/after on `ecosystemImpact` (backend)

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts` (`ecosystemImpact` output + query)

> Same testing note as Task 2 — verified by typecheck + build; KPI math covered by Task 1.

- [ ] **Step 1: Extend the output schema**

In `ecosystemImpact`'s `.output(...)` object (the inner `z.object({ ... })`, lines ~568-578), add three fields after `deltaPct: z.number().nullable(),`:

```ts
          kpiBefore: z.number().nullable(),
          kpiAfter: z.number().nullable(),
          kpiDeltaPct: z.number().nullable(),
```

- [ ] **Step 2: Load per-session KPI inputs (once)**

In the `ecosystemImpact` query body, after the existing `turns` query block (ends ~line 599, the `.all()` for `turns`), insert:

```ts
      // Sessions for KPI before/after: last-turn ms + score/complexity/tokens,
      // bounded by the same `earliest` as the turn pass.
      const sessLast = db()
        .select({ id: agentTurns.sessionId, last: sql<number>`max(${agentTurns.ts})` })
        .from(agentTurns)
        .where(and(gte(agentTurns.ts, new Date(earliest)), trackedCondition()))
        .groupBy(agentTurns.sessionId)
        .all()
      const sessMeta = db()
        .select({
          id: agentSessions.sessionId,
          score: agentSessions.score,
          tin: agentSessions.totalTokensIn,
          tout: agentSessions.totalTokensOut,
        })
        .from(agentSessions)
        .where(
          inArray(
            agentSessions.sessionId,
            sessLast.map((s) => s.id),
          ),
        )
        .all()
      const cmap = sessionComplexityMap()
      const metaById = new Map(sessMeta.map((m) => [m.id, m]))
      const kpiSessions = sessLast.map((s) => {
        const m = metaById.get(s.id)
        return {
          last: s.last,
          score: m?.score ?? null,
          complexity: cmap.get(s.id)?.complexity ?? null,
          tokens: (m?.tin ?? 0) + (m?.tout ?? 0),
        }
      })
```

- [ ] **Step 3: Compute KPI before/after inside the per-change map**

In the `return changes.map((c) => { ... })` body, after the existing token loop computes `deltaPct` (after line ~619, before the `return {`), insert:

```ts
        const kb: { score: number | null; complexity: number | null; tokens: number }[] = []
        const ka: typeof kb = []
        for (const s of kpiSessions) {
          if (s.last >= t - w && s.last < t) kb.push(s)
          else if (s.last >= t && s.last < t + w) ka.push(s)
        }
        const kpiBefore = kpiWindow(kb)
        const kpiAfter = kpiWindow(ka)
        const kpiDeltaPct =
          kpiBefore != null && kpiAfter != null && kpiBefore !== 0
            ? ((kpiAfter - kpiBefore) / kpiBefore) * 100
            : null
```

Then add to the returned object (after `deltaPct,`):

```ts
          kpiBefore,
          kpiAfter,
          kpiDeltaPct,
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(productivity): KPI before/after on ecosystemImpact"
```

---

### Task 4: KPI column in Sessions table (renderer)

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx` (import + SessionsTab header/body)

- [ ] **Step 1: Import the shared per-session helper**

Add near the top imports of `src/renderer/src/pages/Productivity.tsx`:

```ts
import { kpiSession } from '@shared/kpi'
```

- [ ] **Step 2: Add the column header**

In `SessionsTab`'s `<thead>` row (lines ~539-547), insert after the Complexity `<th>`:

```tsx
                <th className="py-2 pr-4 text-right font-medium">KPI</th>
```

- [ ] **Step 3: Add the column cell**

In the `<tbody>` row, immediately after the Complexity `<td>` (closes ~line 567), insert:

```tsx
                  <td
                    className="py-2 pr-4 text-right tabular-nums"
                    title="(score ?? 5.5) × complexity per 1M tokens — higher is more efficient"
                  >
                    {dash(kpiSession(s.score, s.complexity, s.totalTokens), 1)}
                  </td>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(productivity): per-session KPI column in Sessions tab"
```

---

### Task 5: KPI card + KPI line chart on Overview (renderer)

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx` (recharts imports, KpiTooltip, OverviewTab card + chart)

- [ ] **Step 1: Add Recharts Line/LineChart to imports**

In the `from 'recharts'` import block (lines ~16-26), add `Line` and `LineChart` (keep alphabetical-ish ordering used there):

```ts
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  XAxis,
  YAxis,
} from 'recharts'
```

- [ ] **Step 2: Add the KPI tooltip component**

Insert after the `TokensTooltip` function (after line ~124):

```tsx
// KPI-per-day tooltip: efficiency value + session count + any ecosystem change.
function KpiTooltip(props: {
  active?: boolean
  label?: string | number
  payload?: { payload: { kpi: number | null; sessions: number; event: string | null } }[]
}) {
  const row = props.payload?.[0]?.payload
  if (!props.active || !row) return null
  return (
    <div style={tooltipStyle} className="px-2.5 py-2 text-xs">
      <div className="mb-1 font-medium">{props.label}</div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">KPI</span>
        <span className="tabular-nums">{row.kpi == null ? '—' : row.kpi.toFixed(1)}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Sessions</span>
        <span className="tabular-nums">{row.sessions}</span>
      </div>
      {row.event ? (
        <div className="mt-1.5 max-w-56 border-t pt-1.5 text-[var(--color-chart-3)]">
          ⚑ {row.event}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 3: Fetch the KPI query in OverviewTab**

In `OverviewTab`, after the `today` query (line ~211), add:

```ts
  const kpi = trpc.productivity.kpi.useQuery({ days, projectPath })
```

- [ ] **Step 4: Build the KPI chart data (union with event days)**

In `OverviewTab`, after the existing `chartData` / `eventDays` block (after line ~238), add:

```ts
  // KPI per day, unioned with ecosystem-event days (null-filled) so a marker can
  // be drawn even on a day with no in-scope sessions. connectNulls bridges gaps.
  const kpiByDate = new Map((kpi.data?.byDay ?? []).map((d) => [d.date, d] as const))
  const kpiDates = [...new Set([...kpiByDate.keys(), ...ecoMap.keys()])].sort()
  const kpiChartData = kpiDates.map((date) => ({
    date,
    kpi: kpiByDate.get(date)?.kpi ?? null,
    sessions: kpiByDate.get(date)?.sessions ?? 0,
    event: ecoMap.get(date)?.label ?? null,
  }))
```

- [ ] **Step 5: Widen the card grid and add the KPI card**

Change the metric-card grid wrapper (line ~242) from:

```tsx
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
```

to:

```tsx
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
```

Then add a fifth card after the "Avg complexity" `<MetricCard ... />` (line ~249):

```tsx
        <MetricCard label="KPI" value={dash(kpi.data?.overall ?? null)} />
```

- [ ] **Step 6: Add the KPI chart card after "Tokens per day"**

Insert a new `<Card>` immediately after the "Tokens per day" `</Card>` (closes ~line 400) and before the "By project" `<Card>`:

```tsx
      <Card>
        <CardHeader>
          <CardTitle className="text-base">KPI (efficiency)</CardTitle>
          <p className="text-muted-foreground text-xs">
            (score ?? 5.5) × complexity per 1M tokens, token-weighted per day — higher is better.
            {(ecoDays.data?.length ?? 0) > 0 ? ' ⚑ marks ecosystem changes.' : ''}
          </p>
        </CardHeader>
        <CardContent>
          {(kpi.data?.byDay.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">No KPI data yet.</p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={kpiChartData} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    width={44}
                    tickFormatter={(value: number) => value.toFixed(0)}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--color-muted)', strokeWidth: 1 }}
                    content={<KpiTooltip />}
                  />
                  <Line
                    type="monotone"
                    dataKey="kpi"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <EcoMarkers events={eventDays} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
```

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(productivity): KPI card + per-day KPI line chart with eco markers"
```

---

### Task 6: KPI before/after in Change-impact table (renderer)

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx` (`ImpactDelta`, EcosystemTab table)

- [ ] **Step 1: Generalize `ImpactDelta` with a good-direction prop**

Replace the `ImpactDelta` function (lines ~653-662) with:

```tsx
// Delta colouring. goodDirection='down' (default) = lower is better (tokens/turn);
// 'up' = higher is better (KPI). The "good" direction is green, the other red.
function ImpactDelta({
  pct,
  goodDirection = 'down',
}: {
  pct: number | null
  goodDirection?: 'up' | 'down'
}) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const sign = pct > 0 ? '+' : ''
  const good = goodDirection === 'down' ? pct < 0 : pct > 0
  return (
    <span className={cn('tabular-nums', good ? 'text-emerald-500' : 'text-destructive')}>
      {sign}
      {pct.toFixed(0)}%
    </span>
  )
}
```

- [ ] **Step 2: Add KPI column headers**

In the Change-impact `<thead>` row (lines ~746-752), change the existing token Δ header to add right padding and append three KPI headers. Replace:

```tsx
                    <th className="py-2 text-right font-medium">Δ</th>
```

with:

```tsx
                    <th className="py-2 pr-4 text-right font-medium">Δ tok</th>
                    <th className="py-2 pr-4 text-right font-medium">KPI before</th>
                    <th className="py-2 pr-4 text-right font-medium">after</th>
                    <th className="py-2 text-right font-medium">Δ KPI</th>
```

- [ ] **Step 3: Add KPI body cells**

In the Change-impact `<tbody>` row, change the existing token Δ cell to add right padding and append the KPI cells. Replace:

```tsx
                      <td className="py-2 text-right">
                        <ImpactDelta pct={r.deltaPct} />
                      </td>
```

with:

```tsx
                      <td className="py-2 pr-4 text-right">
                        <ImpactDelta pct={r.deltaPct} />
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {r.kpiBefore == null ? '—' : r.kpiBefore.toFixed(1)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {r.kpiAfter == null ? '—' : r.kpiAfter.toFixed(1)}
                      </td>
                      <td className="py-2 text-right">
                        <ImpactDelta pct={r.kpiDeltaPct} goodDirection="up" />
                      </td>
```

- [ ] **Step 4: Clarify the card subtitle**

Update the Change-impact subtitle (lines ~732-735) to mention both metrics. Replace:

```tsx
            Avg tokens/turn 7 days before vs after each change (global). Lower after = more
            efficient.
```

with:

```tsx
            7 days before vs after each change (global). Tokens/turn: lower after = better. KPI:
            higher after = better.
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(productivity): KPI before/after columns in Change impact table"
```

---

### Task 7: Align RatingControl unrated default to 5.5

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx` (`RatingControl`)

- [ ] **Step 1: Update the placeholder option**

In `RatingControl` (line ~633), replace:

```tsx
      <option value="">— (7)</option>
```

with:

```tsx
      <option value="">— (5.5)</option>
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "fix(productivity): unrated rating hint matches KPI imputation (5.5)"
```

---

### Task 8: Full verification

**Files:** none (gate only)

- [ ] **Step 1: Run the unit tests**

Run: `pnpm test`
Expected: PASS — all prior tests plus the new `kpi.test.ts` cases.

- [ ] **Step 2: Typecheck (node + web)**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS (no Biome errors in changed files).

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: PASS (electron-vite build succeeds; KPI procedure + chart compile).

- [ ] **Step 5: Manual check (if a display is available)**

Launch the app, open Productivity → Overview: KPI card shows a value, "KPI (efficiency)" line chart renders with ⚑ markers aligned to ecosystem-change days. Sessions tab: KPI column populated. Ecosystem tab: Change-impact table shows KPI before/after with Δ KPI green when higher. (Headless env: skip — covered by build + the recharts overlay pattern in [[recharts-v3-overlay-markers]].)
