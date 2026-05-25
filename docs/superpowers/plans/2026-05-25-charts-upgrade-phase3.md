# Charts Upgrade — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Click a day on the tokens-per-day or Token Efficiency chart → a right-side drawer slides in showing that day's sessions plus a token/Eff/project breakdown. No backend changes — reuse the already-windowed `productivity.sessions` query and filter by day on the client.

**Architecture:** Pure logic (`inDayRange`, `summarizeDay`, `localDay`) lives in a `.ts` file unit-tested with vitest (node env). The `DayDrawer` is a fixed-position React overlay (backdrop + right panel) built from scratch — there is no existing drawer/modal/portal in this repo (only `InfoPopover`), so mirror the terminal panel aesthetic with inline styles. The clicked day comes from recharts' chart-level `onClick` (`activeLabel` = the clicked x-axis category, a `YYYY-MM-DD` string). Day membership = the session's local activity-day range `[localDay(startedAt) … localDay(endedAt)]` includes the clicked day; `productivity.sessions` exposes no per-day field, and a session can span days, so this range test is the MVP filter.

**Tech Stack:** React 19, recharts 3.8, TypeScript (strict), Tailwind v4 + CSS vars, vitest 4 (node), tRPC + react-query.

**Spec:** `docs/superpowers/specs/2026-05-24-charts-upgrade-design.md` (Phase 3 + `DayDrawer` architecture row + "Risks": drawer for a clicked day outside the loaded session window — note empties rather than silently showing nothing).

**Prior art:** Phase 2 plan `docs/superpowers/plans/2026-05-25-charts-upgrade-phase2.md` (same conventions, file layout, TDD rhythm). Phase 1 + 2 are merged to `main`.

**Conventions (read before starting):**
- Tests colocate as `*.test.ts`; run `pnpm test <path>`. vitest globs only `.ts` (not `.tsx`), node env — keep tested logic in `.ts`, no React/DOM in tests.
- Aliases: `@renderer`, `@main`, `@shared`. Class merge helper: `cn` from `@renderer/lib/utils`.
- Terminal aesthetic: mono (`var(--mono)`), amber (`var(--amber)`, `var(--amber-dim)`), `var(--fg)`/`--fg-2`/`--fg-3`/`--fg-4`, hairlines `var(--line)`/`var(--line-dim)`/`var(--color-border)`, no border-radius. Reuse existing helpers in `Productivity.tsx`: `num()`, `pct()`, `dash()`, `fmtDate()`, `NoteLine`, `.panel`/`.panel-head`/`.panel-body`/`.btn`/`.tbl` classes.
- biome enforces import order + line width; after editing run `pnpm exec biome check --write <file>` then `pnpm lint`.
- Keep `EcoMarkers` + `ReferenceLine y=100` untouched (recharts v3 async-paint quirk — memory `recharts-v3-overlay-markers`).
- Ignore the `git-commit-message` skill if it triggers (wrong repo — memory `git-commit-message-skill-wrong-repo`). Conventional-commit messages.
- Pre-commit hook runs `pnpm lint && pnpm typecheck`; every commit must pass both. Branch off `main` first (e.g. `feat/charts-upgrade-phase3`); do not commit feature work directly on `main`.

**In scope:** DayDrawer on the two Productivity daily charts (tokens-per-day, Token Efficiency).

**Out of scope (deferred):** today-by-hour click→drawer (its x-axis is `hour`, not a date; sessions carry no hour granularity); Stats events-per-day drawer (different page/query); today-by-hour readout HUD; Stats compare overlay. A backend `day` param for out-of-window precision (not needed: the daily charts only render in-window days, so the windowed `sessions` query always covers a clicked day).

---

## File Structure

| File | Type | Responsibility |
|---|---|---|
| `src/renderer/src/components/charts/daySessions.ts` | pure | `localDay(date)`, `inDayRange(day, start, end)`, `summarizeDay(sessions)`. |
| `src/renderer/src/components/charts/daySessions.test.ts` | test | `inDayRange` boundaries + `summarizeDay` aggregation. |
| `src/renderer/src/components/charts/DayDrawer.tsx` | component | Fixed right drawer: backdrop, Esc/click-out close, day summary + session list. |
| `src/renderer/src/pages/Productivity.tsx` | modify | `drawerDay` state, chart `onClick` wiring, day-scoped sessions query, filter + render `DayDrawer`. |

---

## Task 1: pure day helpers (tested)

**Files:**
- Create: `src/renderer/src/components/charts/daySessions.ts`
- Test: `src/renderer/src/components/charts/daySessions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/components/charts/daySessions.test.ts
import { describe, expect, it } from 'vitest'
import { inDayRange, summarizeDay } from './daySessions'

describe('inDayRange', () => {
  it('includes a day inside [start, end]', () => {
    expect(inDayRange('2026-05-10', '2026-05-09', '2026-05-11')).toBe(true)
  })
  it('includes the boundary days', () => {
    expect(inDayRange('2026-05-09', '2026-05-09', '2026-05-11')).toBe(true)
    expect(inDayRange('2026-05-11', '2026-05-09', '2026-05-11')).toBe(true)
  })
  it('excludes days before start or after end', () => {
    expect(inDayRange('2026-05-08', '2026-05-09', '2026-05-11')).toBe(false)
    expect(inDayRange('2026-05-12', '2026-05-09', '2026-05-11')).toBe(false)
  })
  it('tolerates a null bound as open-ended', () => {
    expect(inDayRange('2026-05-10', null, '2026-05-11')).toBe(true)
    expect(inDayRange('2026-05-10', '2026-05-09', null)).toBe(true)
  })
  it('returns false when both bounds are null (cannot place the session)', () => {
    expect(inDayRange('2026-05-10', null, null)).toBe(false)
  })
})

describe('summarizeDay', () => {
  it('returns zeros for an empty day', () => {
    expect(summarizeDay([])).toEqual({ count: 0, totalTokens: 0, avgKpi: null, byProject: [] })
  })
  it('sums tokens, averages non-null Eff, groups projects desc by tokens', () => {
    const out = summarizeDay([
      { totalTokens: 100, kpi: 80, project: 'atlas' },
      { totalTokens: 300, kpi: null, project: 'mako' },
      { totalTokens: 50, kpi: 120, project: 'atlas' },
    ])
    expect(out.count).toBe(3)
    expect(out.totalTokens).toBe(450)
    expect(out.avgKpi).toBe(100) // (80 + 120) / 2; null skipped
    expect(out.byProject).toEqual([
      { project: 'mako', tokens: 300, sessions: 1 },
      { project: 'atlas', tokens: 150, sessions: 2 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/src/components/charts/daySessions.test.ts`
Expected: FAIL — cannot resolve `./daySessions`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/components/charts/daySessions.ts
// Day-scoped helpers for the click→drawer drilldown.

// Local YYYY-MM-DD for a Date/ISO string, matching the chart's
// date(ts,'unixepoch','localtime') keys. null/invalid in → null out.
// (Not unit-tested: output is timezone-dependent. Verified via the app run.)
export function localDay(d: Date | string | null): string | null {
  if (d == null) return null
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-CA') // 'YYYY-MM-DD' in local tz
}

// True if `day` (YYYY-MM-DD) falls within [start, end] inclusive. A null bound
// is open-ended; both null → false (the session can't be placed on a calendar).
export function inDayRange(day: string, start: string | null, end: string | null): boolean {
  if (start == null && end == null) return false
  if (start != null && day < start) return false
  if (end != null && day > end) return false
  return true
}

export interface DaySessionLite {
  totalTokens: number
  kpi: number | null
  project: string
}

export interface DaySummary {
  count: number
  totalTokens: number
  avgKpi: number | null
  byProject: { project: string; tokens: number; sessions: number }[]
}

// Aggregate a day's sessions: count, total tokens, mean of non-null Eff, and a
// per-project breakdown sorted by tokens desc.
export function summarizeDay(sessions: ReadonlyArray<DaySessionLite>): DaySummary {
  let totalTokens = 0
  const kpis: number[] = []
  const proj = new Map<string, { tokens: number; sessions: number }>()
  for (const s of sessions) {
    totalTokens += s.totalTokens
    if (s.kpi != null) kpis.push(s.kpi)
    const p = proj.get(s.project) ?? { tokens: 0, sessions: 0 }
    p.tokens += s.totalTokens
    p.sessions += 1
    proj.set(s.project, p)
  }
  const avgKpi = kpis.length ? kpis.reduce((a, x) => a + x, 0) / kpis.length : null
  const byProject = [...proj.entries()]
    .map(([project, v]) => ({ project, tokens: v.tokens, sessions: v.sessions }))
    .sort((a, b) => b.tokens - a.tokens)
  return { count: sessions.length, totalTokens, avgKpi, byProject }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/renderer/src/components/charts/daySessions.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/charts/daySessions.ts src/renderer/src/components/charts/daySessions.test.ts
git commit -m "feat(charts): add day-scoped session helpers for drilldown"
```

---

## Task 2: DayDrawer component

**Files:**
- Create: `src/renderer/src/components/charts/DayDrawer.tsx`

No unit test (React component; repo has no testing-library). Verified by strict `tsc` + the app run in Task 4.

- [ ] **Step 1: Write the component**

The drawer is self-contained: it takes the already-day-filtered sessions and renders them. Esc and backdrop-click close it. Returns `null` when `day` is null (closed).

```tsx
// src/renderer/src/components/charts/DayDrawer.tsx
import { cn } from '@renderer/lib/utils'
import { useEffect } from 'react'
import { type DaySummary, summarizeDay } from './daySessions'

export interface DrawerSession {
  sessionId: string
  project: string
  projectPath: string
  totalTokens: number
  kpi: number | null
  complexity: number | null
  turnCount: number
  summary: string | null
}

const fmtInt = new Intl.NumberFormat('en-US')
const num = (n: number): string => fmtInt.format(n)
const pct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(0)}%`)
const dash = (v: number | null, d = 1): string => (v == null ? '—' : v.toFixed(d))

// Right-side slide-in drawer for one day's drilldown. Backdrop + Esc close.
// `sessions` is already filtered to `day` by the caller.
export function DayDrawer({
  day,
  sessions,
  loading,
  onClose,
}: {
  day: string | null
  sessions: DrawerSession[]
  loading: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (day == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [day, onClose])

  if (day == null) return null
  const sum: DaySummary = summarizeDay(sessions)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          border: 0,
          cursor: 'default',
        }}
      />
      {/* panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Sessions on ${day}`}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(440px, 90vw)',
          background: 'var(--color-background)',
          borderLeft: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          className="panel-head"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span className="ttl">
            <span style={{ color: 'var(--amber)' }}>{day}</span> · sessions
          </span>
          <button type="button" className="btn" onClick={onClose}>
            ✕ CLOSE
          </button>
        </div>

        {/* summary */}
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--line-dim)',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--fg-4)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 20px',
          }}
        >
          <span>
            <span style={{ color: 'var(--fg)' }} className="tabular-nums">
              {sum.count}
            </span>{' '}
            sessions
          </span>
          <span>
            <span style={{ color: 'var(--fg)' }} className="tabular-nums">
              {num(sum.totalTokens)}
            </span>{' '}
            tokens
          </span>
          <span>
            <span style={{ color: 'var(--amber)' }} className="tabular-nums">
              {pct(sum.avgKpi)}
            </span>{' '}
            avg Eff
          </span>
        </div>

        {/* by project */}
        {sum.byProject.length > 0 ? (
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--line-dim)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
            }}
          >
            {sum.byProject.map((p) => (
              <div
                key={p.project}
                style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fg-3)' }}
              >
                <span className="truncate" title={p.project}>
                  {p.project}
                </span>
                <span className="tabular-nums" style={{ color: 'var(--fg-4)' }}>
                  {num(p.tokens)} · {p.sessions}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {/* session list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--fg-4)',
                padding: '12px 14px',
              }}
            >
              <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>loading…
            </p>
          ) : sessions.length === 0 ? (
            <p
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--fg-4)',
                padding: '12px 14px',
              }}
            >
              <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>no sessions loaded for this
              day.
            </p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column' }}>
              {sessions.map((s) => (
                <li
                  key={s.sessionId}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--line-dim)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <span style={{ color: 'var(--fg-2)' }} title={s.projectPath}>
                      {s.project}
                    </span>
                    <span
                      className={cn('tabular-nums')}
                      style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)' }}
                    >
                      {num(s.totalTokens)} tok · {pct(s.kpi)} · cx {dash(s.complexity)} ·{' '}
                      {num(s.turnCount)}t
                    </span>
                  </div>
                  {s.summary ? (
                    <span
                      className="line-clamp-2"
                      style={{ fontSize: 12, color: 'var(--fg-3)' }}
                      title={s.summary}
                    >
                      {s.summary}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm exec biome check --write src/renderer/src/components/charts/DayDrawer.tsx && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/charts/DayDrawer.tsx
git commit -m "feat(charts): add DayDrawer drilldown panel"
```

---

## Task 3: wire DayDrawer into Productivity

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

The clicked day lifts to `OverviewTab` state; sessions are fetched only while the drawer is open and filtered client-side; `DailyCharts` forwards chart clicks.

- [ ] **Step 1: Add imports**

After the existing charts imports near the top, add:

```ts
import { DayDrawer, type DrawerSession } from '@renderer/components/charts/DayDrawer'
import { inDayRange, localDay } from '@renderer/components/charts/daySessions'
```

- [ ] **Step 2: Add `onDayClick` to `DailyCharts` props + a click handler, and wire both charts**

In the `DailyCharts` destructure params add `onDayClick`, and in its prop type add `onDayClick: (day: string) => void`. Then, next to the existing `onBrush` handler, add:

```tsx
  const onChartClick = (s: { activeLabel?: string | number }) => {
    if (s?.activeLabel != null) onDayClick(String(s.activeLabel))
  }
```

Wire it on **both** date charts. The tokens chart opens with:

```tsx
                <ComposedChart
                  data={chartData}
                  syncId={tokensPerDayMeta.syncGroup}
                  onMouseMove={onMove}
                  onMouseLeave={onLeave}
                  margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
                >
```

Add `onClick={onChartClick}` after `onMouseLeave={onLeave}`:

```tsx
                <ComposedChart
                  data={chartData}
                  syncId={tokensPerDayMeta.syncGroup}
                  onMouseMove={onMove}
                  onMouseLeave={onLeave}
                  onClick={onChartClick}
                  margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
                >
```

Do the same for the Token Efficiency `<LineChart>` opening (it has the identical `onMouseMove`/`onMouseLeave`/`margin` lines — add `onClick={onChartClick}` after `onMouseLeave={onLeave}` there too).

- [ ] **Step 3: Add drawer state, day-scoped sessions query, and filtered rows in `OverviewTab`**

Next to the Phase-2 `compare`/`brushRange` state in `OverviewTab`, add:

```tsx
  const [drawerDay, setDrawerDay] = useState<string | null>(null)

  // Sessions for the drilldown drawer — fetched only while open, same window as
  // the charts so a clicked (in-window) day is always covered.
  const daySessions = trpc.productivity.sessions.useQuery(
    { days, projectPath },
    { enabled: drawerDay != null },
  )

  // Sessions whose local activity-day range includes the clicked day.
  const drawerRows = useMemo<DrawerSession[]>(() => {
    if (drawerDay == null) return []
    return (daySessions.data ?? [])
      .filter((s) => inDayRange(drawerDay, localDay(s.startedAt), localDay(s.endedAt)))
      .map((s) => ({
        sessionId: s.sessionId,
        project: s.project,
        projectPath: s.projectPath,
        totalTokens: s.totalTokens,
        kpi: s.kpi,
        complexity: s.complexity,
        turnCount: s.turnCount,
        summary: s.summary,
      }))
  }, [drawerDay, daySessions.data])
```

- [ ] **Step 4: Pass `onDayClick` into `DailyCharts` and render the drawer**

Add `onDayClick={setDrawerDay}` to the `<DailyCharts ... />` invocation (alongside the Phase-2 props).

Then render the drawer once, at the end of the `OverviewTab` returned fragment (just before the closing `</>`):

```tsx
      <DayDrawer
        day={drawerDay}
        sessions={drawerRows}
        loading={daySessions.isLoading}
        onClose={() => setDrawerDay(null)}
      />
```

- [ ] **Step 5: Verify typecheck + lint**

Run: `pnpm exec biome check --write src/renderer/src/pages/Productivity.tsx && pnpm typecheck && pnpm lint`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(charts): click a day to open the session drilldown drawer"
```

---

## Task 4: full verification

**Files:** none.

- [ ] **Step 1: Tests**

Run: `pnpm test`
Expected: all pass, including the new `daySessions.test.ts` (7).

- [ ] **Step 2: Typecheck + lint + build**

Run: `pnpm typecheck && pnpm lint && pnpm build`
Expected: all PASS; renderer bundles.

- [ ] **Step 3: Manual app run**

Run: `pnpm dev`. On Productivity → overview:
- Click a bar/point on tokens-per-day → drawer slides in from the right showing that day's session count, total tokens, avg Eff, per-project breakdown, and the session list. Chart stays visible behind the backdrop.
- Click a point on Token Efficiency → same drawer for that day.
- Esc closes it; clicking the backdrop closes it; ✕ CLOSE closes it.
- A day whose loaded sessions don't cover it shows the `// no sessions loaded for this day.` note rather than an empty panel.
- Phase 1/2 behaviors still work: crosshair sync, legend toggles, `?` popover, shared brush zoom, compare overlay. (Clicking to open the drawer must not interfere with the brush or the compare toggle.)

- [ ] **Step 4: Update memory**

Update `charts-upgrade-phases.md`: mark Phase 3 DONE (DayDrawer on the two daily charts; client-side day filter via `inDayRange`/`localDay`; no backend change). Note remaining deferrals: today-by-hour click + HUD, Stats drawer + compare. Update the `MEMORY.md` index hook line. Charts upgrade complete.

---

## Self-Review

**Spec coverage (Phase 3):**
- `DayDrawer` right-side slide-in, click day → sessions + breakdown → Tasks 2 + 3. ✅
- Reuse `productivity.sessions`, client-side day filter, no backend change → Task 3 (`enabled` on open) + Task 1 (`inDayRange`/`localDay`). ✅
- Close on Esc / backdrop → Task 2. ✅
- Risk (clicked day outside loaded window → note empties) → handled: charts only show in-window days so the windowed query covers them; the `// no sessions loaded` note covers any residual mismatch. ✅
- Deferrals (today click, Stats drawer) documented in scope. ✅

**Placeholder scan:** none — every step has full code.

**Type consistency:** `DrawerSession` (Task 2) is produced by Task 3's `drawerRows.map`. `DaySessionLite`/`DaySummary` (Task 1) consumed by `summarizeDay` in `DayDrawer`. `inDayRange`/`localDay` (Task 1) used in Task 3. `onDayClick: (day: string) => void` matches `setDrawerDay` (`Dispatch<SetStateAction<string | null>>` accepts a `string`). `activeLabel` coerced to `String(...)` before use. ✅
