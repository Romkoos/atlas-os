# КПД Efficiency Metric — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the corpus-percentile KPI with a frozen-baseline efficiency coefficient `КПД = expectedTokens(difficulty) / actualTokens × 100%`, plus a quality guardrail line and per-change before/after table.

**Architecture:** Pure math in `src/shared/kpi.ts` (baseline fit, expected tokens, per-session КПД, per-day aggregation). A `baseline.ts` service freezes the model in a new `kpi_baseline` table. The productivity tRPC router computes per-session КПД from the frozen model and serves the KPI line + quality line + before/after impact. Difficulty (1–10) is a new session field, manually set in the UI and optionally LLM-estimated at ingest. The metric works out-of-the-box via a `global-median` baseline (no difficulty needed); `loglinear` normalization kicks in once difficulty data exists.

**Tech Stack:** TypeScript, Electron, better-sqlite3 + Drizzle ORM, tRPC v11 (custom IPC), React + Recharts (v3), Vitest, Biome. Pre-commit hook runs `pnpm lint && pnpm typecheck` — **every commit must keep the whole project compiling.**

**Reference spec:** `docs/superpowers/specs/2026-05-24-kpd-efficiency-metric-design.md`

**Critical ordering rule:** New `kpi.ts` functions are ADDED alongside the old ones; the old percentile functions are removed only AFTER the router stops referencing them (Task 9). This keeps `pnpm typecheck` green at every commit.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `src/main/db/schema.ts` | add `difficulty`/`difficultySource` to `agentSessions`; new `kpiBaseline` table | Modify |
| `src/shared/kpi.ts` | pure baseline/КПД math | Rewrite (additive then prune) |
| `src/shared/kpi.test.ts` | pure-math unit tests | Rewrite |
| `src/main/services/productivity/baseline.ts` | freeze/load/refit baseline (DB) | Create |
| `src/main/services/productivity/baseline.test.ts` | pure baseline-selection tests | Create |
| `src/main/trpc/routers/productivity.ts` | КПД rows helper, rewrite `kpi`/`ecosystemImpact`, add `setDifficulty`/`rebaseline`, extend `sessions` | Modify |
| `src/renderer/src/pages/Productivity.tsx` | dual-line chart, difficulty control, re-baseline button | Modify |
| `src/shared/settings.ts` | `estimateDifficulty` flag | Modify |
| `src/main/services/productivity/difficulty.ts` | LLM difficulty estimator (gated) | Create |
| `src/main/services/productivity/transcript.ts` | capture first user prompt per session | Modify |
| `src/main/services/productivity/ingest.ts` | call estimator for null-difficulty sessions when enabled | Modify |

---

## Task 1: Schema — difficulty fields + kpi_baseline table

**Files:**
- Modify: `src/main/db/schema.ts`
- Generated: a new migration file under the drizzle `out` folder (via `pnpm db:generate`)

- [ ] **Step 1: Add difficulty columns to `agentSessions`**

In `src/main/db/schema.ts`, inside the `agentSessions` table definition, add these two columns immediately after the `score` column:

```typescript
    score: integer('score'), // 1–10, user-set via setRating
    difficulty: integer('difficulty'), // 1–10 intrinsic task difficulty; null = unknown
    difficultySource: text('difficulty_source'), // 'llm' | 'manual' | null
```

- [ ] **Step 2: Add the `kpiBaseline` table**

In `src/main/db/schema.ts`, after the `ecosystemChanges` table definition, add:

```typescript
// A frozen efficiency baseline per scope (project path or '__global__').
// `expectedTokens(difficulty)` is derived from `method` + `params`; the latest
// row per scope is active. New rows are written only on first use or explicit
// re-baseline, so historical КПД never mutates on its own.
export const kpiBaseline = sqliteTable(
  'kpi_baseline',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(), // projectPath or '__global__'
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    periodStart: integer('period_start', { mode: 'timestamp_ms' }),
    periodEnd: integer('period_end', { mode: 'timestamp_ms' }),
    method: text('method').notNull(), // 'loglinear' | 'global-median'
    params: text('params', { mode: 'json' })
      .$type<{ a?: number; b?: number; median?: number }>()
      .notNull(),
    sessionCount: integer('session_count').notNull(),
  },
  (t) => [index('idx_kpi_baseline_scope').on(t.scope)],
)

export type KpiBaselineRow = typeof kpiBaseline.$inferSelect
export type NewKpiBaselineRow = typeof kpiBaseline.$inferInsert
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm db:generate`
Expected: drizzle-kit prints a new migration (e.g. `XXXX_*.sql`) adding 2 columns to `agent_sessions` and creating `kpi_baseline`. If drizzle-kit asks an interactive question, it is non-interactive here — verify a `.sql` file was created under the migrations `out` dir (`git status` shows a new file).

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (new columns/table are additive).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/schema.ts drizzle/ migrations/ 2>/dev/null; git add -A
git commit -m "feat(kpi): add difficulty fields and kpi_baseline table"
```

---

## Task 2: kpi.ts — baseline types, fitBaseline, expectedTokens (TDD)

**Files:**
- Modify: `src/shared/kpi.ts` (ADD new exports; keep old ones for now)
- Modify: `src/shared/kpi.test.ts` (ADD new describe blocks; keep old ones)

- [ ] **Step 1: Write failing tests** — append to `src/shared/kpi.test.ts`:

```typescript
import {
  type BaselineModel,
  expectedTokens,
  fitBaseline,
  sessionKpd,
} from '@shared/kpi'

describe('fitBaseline', () => {
  it('returns null when no valid samples', () => {
    expect(fitBaseline([])).toBeNull()
    expect(fitBaseline([{ difficulty: 5, tokens: 0 }])).toBeNull()
  })
  it('falls back to global-median when difficulty coverage is thin', () => {
    const samples = [
      { difficulty: null, tokens: 100 },
      { difficulty: null, tokens: 300 },
      { difficulty: null, tokens: 200 },
    ]
    const m = fitBaseline(samples)
    expect(m?.method).toBe('global-median')
    expect(m?.params.median).toBe(200)
  })
  it('fits loglinear when enough difficulty-tagged samples across ≥2 levels', () => {
    // tokens grow with difficulty: expected ≈ exp(a + b*d), b > 0
    const samples = [
      { difficulty: 2, tokens: 1000 },
      { difficulty: 2, tokens: 1100 },
      { difficulty: 2, tokens: 900 },
      { difficulty: 2, tokens: 1000 },
      { difficulty: 8, tokens: 8000 },
      { difficulty: 8, tokens: 8200 },
      { difficulty: 8, tokens: 7800 },
      { difficulty: 8, tokens: 8000 },
    ]
    const m = fitBaseline(samples)
    expect(m?.method).toBe('loglinear')
    expect(m?.params.b).toBeGreaterThan(0)
  })
})

describe('expectedTokens', () => {
  it('global-median ignores difficulty', () => {
    const m: BaselineModel = { method: 'global-median', params: { median: 500 } }
    expect(expectedTokens(m, null)).toBe(500)
    expect(expectedTokens(m, 7)).toBe(500)
  })
  it('loglinear returns exp(a + b*d), null when difficulty missing', () => {
    const m: BaselineModel = { method: 'loglinear', params: { a: 0, b: 1 } }
    expect(expectedTokens(m, 2)).toBeCloseTo(Math.exp(2), 6)
    expect(expectedTokens(m, null)).toBeNull()
  })
})

describe('sessionKpd', () => {
  it('is expected/actual × 100', () => {
    expect(sessionKpd(500, 250)).toBe(200)
    expect(sessionKpd(500, 500)).toBe(100)
  })
  it('returns null on bad inputs', () => {
    expect(sessionKpd(null, 100)).toBeNull()
    expect(sessionKpd(0, 100)).toBeNull()
    expect(sessionKpd(500, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm test -- src/shared/kpi.test.ts`
Expected: FAIL — `fitBaseline`, `expectedTokens`, `sessionKpd`, `BaselineModel` not exported.

- [ ] **Step 3: Implement** — append to `src/shared/kpi.ts`:

```typescript
// ── Frozen-baseline КПД model ────────────────────────────────────────────────
// КПД = expectedTokens(difficulty) / actualTokens × 100. expectedTokens comes
// from a baseline frozen at the project's starting period. Two methods:
//   - global-median: expected = median baseline tokens (difficulty ignored).
//     Used until enough difficulty-tagged data exists. Makes КПД work day one.
//   - loglinear: expected = exp(a + b·difficulty), fit on baseline medians.
//     Used once ≥8 difficulty-tagged sessions span ≥2 difficulty levels.

export type BaselineMethod = 'loglinear' | 'global-median'
export interface BaselineParams {
  a?: number
  b?: number
  median?: number
}
export interface BaselineModel {
  method: BaselineMethod
  params: BaselineParams
}
export interface BaselineSample {
  difficulty: number | null
  tokens: number
}

const MIN_DIFFICULTY_COVERAGE = 8

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Fit a frozen baseline from starting-period samples. Null if no usable tokens.
export function fitBaseline(samples: BaselineSample[]): BaselineModel | null {
  const valid = samples.filter((s) => s.tokens > 0)
  if (valid.length === 0) return null

  const withDiff = valid.filter(
    (s): s is { difficulty: number; tokens: number } => s.difficulty != null,
  )
  if (withDiff.length >= MIN_DIFFICULTY_COVERAGE) {
    const byD = new Map<number, number[]>()
    for (const s of withDiff) {
      const arr = byD.get(s.difficulty) ?? []
      arr.push(Math.log(s.tokens))
      byD.set(s.difficulty, arr)
    }
    if (byD.size >= 2) {
      // Least squares on per-difficulty medians of log(tokens) → robust slope.
      const pts = [...byD.entries()].map(([x, logs]) => ({ x, y: medianOf(logs) }))
      const n = pts.length
      const sx = pts.reduce((a, p) => a + p.x, 0)
      const sy = pts.reduce((a, p) => a + p.y, 0)
      const sxx = pts.reduce((a, p) => a + p.x * p.x, 0)
      const sxy = pts.reduce((a, p) => a + p.x * p.y, 0)
      const denom = n * sxx - sx * sx
      if (denom !== 0) {
        const b = (n * sxy - sx * sy) / denom
        const a = (sy - b * sx) / n
        if (b > 0) return { method: 'loglinear', params: { a, b } }
      }
    }
  }
  return { method: 'global-median', params: { median: medianOf(valid.map((s) => s.tokens)) } }
}

// Expected token cost for a task of the given difficulty under the frozen model.
export function expectedTokens(model: BaselineModel, difficulty: number | null): number | null {
  if (model.method === 'global-median') return model.params.median ?? null
  if (difficulty == null) return null
  const { a, b } = model.params
  if (a == null || b == null) return null
  return Math.exp(a + b * difficulty)
}

// Per-session КПД (%). >100 = leaner than baseline. Null on unusable inputs.
export function sessionKpd(expected: number | null, actualTokens: number): number | null {
  if (expected == null || expected <= 0 || actualTokens <= 0) return null
  return (expected / actualTokens) * 100
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test -- src/shared/kpi.test.ts`
Expected: PASS (new blocks pass; old blocks still pass).

- [ ] **Step 5: Commit**

```bash
git add src/shared/kpi.ts src/shared/kpi.test.ts
git commit -m "feat(kpi): add fitBaseline, expectedTokens, sessionKpd (pure)"
```

---

## Task 3: kpi.ts — new kpiByDay (КПД + quality) (TDD)

The new `kpiByDay` averages КПД values and a quality mean, replacing the percentile version. It uses a DIFFERENT input shape, so add it under a new name `kpdByDay` first to avoid clashing with the old `kpiByDay` (removed in Task 9), then swap the router. (Two names coexist only between Task 3 and Task 9.)

**Files:**
- Modify: `src/shared/kpi.ts`
- Modify: `src/shared/kpi.test.ts`

- [ ] **Step 1: Write failing test** — append to `src/shared/kpi.test.ts`:

```typescript
import { kpdByDay } from '@shared/kpi'

describe('kpdByDay', () => {
  it('averages КПД per day, averages rated quality, sorts by date', () => {
    const out = kpdByDay([
      { day: '2026-05-02', kpd: 120, score: 8 },
      { day: '2026-05-01', kpd: 100, score: null },
      { day: '2026-05-01', kpd: 140, score: 6 },
    ])
    expect(out).toEqual([
      { date: '2026-05-01', kpi: 120, quality: 6, sessions: 2 },
      { date: '2026-05-02', kpi: 120, quality: 8, sessions: 1 },
    ])
  })
  it('quality is null when no rated sessions that day', () => {
    const out = kpdByDay([{ day: '2026-05-01', kpd: 100, score: null }])
    expect(out[0].quality).toBeNull()
  })
  it('returns [] for empty input', () => {
    expect(kpdByDay([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm test -- src/shared/kpi.test.ts`
Expected: FAIL — `kpdByDay` not exported.

- [ ] **Step 3: Implement** — append to `src/shared/kpi.ts`:

```typescript
/** A session's КПД (%) for a local calendar day, plus optional quality score. */
export interface KpdDaySession {
  day: string
  kpd: number
  score: number | null
}

export interface KpdDay {
  date: string
  kpi: number // mean КПД (%)
  quality: number | null // mean of rated scores that day, or null
  sessions: number
}

// Group by day; mean КПД and mean rated quality per day; sort by date.
export function kpdByDay(sessions: KpdDaySession[]): KpdDay[] {
  const byDay = new Map<string, { kpds: number[]; scores: number[] }>()
  for (const s of sessions) {
    const e = byDay.get(s.day) ?? { kpds: [], scores: [] }
    e.kpds.push(s.kpd)
    if (s.score != null) e.scores.push(s.score)
    byDay.set(s.day, e)
  }
  const out: KpdDay[] = []
  for (const [date, e] of byDay) {
    if (e.kpds.length === 0) continue
    out.push({
      date,
      kpi: e.kpds.reduce((a, x) => a + x, 0) / e.kpds.length,
      quality: e.scores.length ? e.scores.reduce((a, x) => a + x, 0) / e.scores.length : null,
      sessions: e.kpds.length,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm test -- src/shared/kpi.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/kpi.ts src/shared/kpi.test.ts
git commit -m "feat(kpi): add kpdByDay (КПД + quality aggregation)"
```

---

## Task 4: baseline.ts — selection + persistence service (TDD for pure part)

**Files:**
- Create: `src/main/services/productivity/baseline.ts`
- Create: `src/main/services/productivity/baseline.test.ts`

- [ ] **Step 1: Write failing test** — `src/main/services/productivity/baseline.test.ts`:

```typescript
import { selectBaselineSamples, type ScopedSession } from '@main/services/productivity/baseline'
import { describe, expect, it } from 'vitest'

const s = (id: string, lastTs: number): ScopedSession => ({
  id,
  difficulty: null,
  tokens: 1000,
  score: null,
  lastTs,
})

describe('selectBaselineSamples', () => {
  it('returns [] for empty input', () => {
    expect(selectBaselineSamples([])).toEqual([])
  })
  it('uses all sessions when fewer than the minimum', () => {
    const rows = [s('a', 1), s('b', 2), s('c', 3)]
    expect(selectBaselineSamples(rows)).toHaveLength(3)
  })
  it('takes the earliest max(15, 25%) when plentiful', () => {
    const rows = Array.from({ length: 100 }, (_, i) => s(`x${i}`, i))
    const picked = selectBaselineSamples(rows)
    expect(picked).toHaveLength(25) // ceil(0.25*100)
    expect(picked[0].id).toBe('x0')
    expect(picked.at(-1)?.id).toBe('x24')
  })
  it('floors at 15 when 25% is smaller', () => {
    const rows = Array.from({ length: 40 }, (_, i) => s(`x${i}`, i))
    expect(selectBaselineSamples(rows)).toHaveLength(15) // max(15, 10)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm test -- src/main/services/productivity/baseline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/main/services/productivity/baseline.ts`:

```typescript
import { randomUUID } from 'node:crypto'
import { db } from '@main/db/client'
import { kpiBaseline } from '@main/db/schema'
import { type BaselineModel, fitBaseline } from '@shared/kpi'
import { desc, eq } from 'drizzle-orm'

const BASELINE_MIN_SESSIONS = 15
const BASELINE_FRACTION = 0.25

export interface ScopedSession {
  id: string
  difficulty: number | null
  tokens: number
  score: number | null
  lastTs: number // ms epoch of the session's last turn
}

export const scopeKey = (projectPath?: string): string => projectPath ?? '__global__'

// The starting reference: earliest max(15, 25%) sessions by time. `sorted` MUST
// be ascending by lastTs. Pure — unit tested.
export function selectBaselineSamples(sorted: ScopedSession[]): ScopedSession[] {
  if (sorted.length === 0) return []
  const n = Math.min(
    sorted.length,
    Math.max(BASELINE_MIN_SESSIONS, Math.ceil(sorted.length * BASELINE_FRACTION)),
  )
  return sorted.slice(0, n)
}

export function getActiveBaseline(scope: string): BaselineModel | null {
  const row = db()
    .select()
    .from(kpiBaseline)
    .where(eq(kpiBaseline.scope, scope))
    .orderBy(desc(kpiBaseline.createdAt))
    .limit(1)
    .get()
  if (!row) return null
  return { method: row.method as BaselineModel['method'], params: row.params }
}

function saveBaseline(scope: string, model: BaselineModel, used: ScopedSession[]): void {
  db()
    .insert(kpiBaseline)
    .values({
      id: randomUUID(),
      scope,
      createdAt: new Date(),
      periodStart: used.length ? new Date(used[0].lastTs) : null,
      periodEnd: used.length ? new Date(used[used.length - 1].lastTs) : null,
      method: model.method,
      params: model.params,
      sessionCount: used.length,
    })
    .run()
}

// Return the active baseline, fitting + freezing one from the starting period if
// none exists. `scopedSorted` MUST be ascending by lastTs.
export function ensureBaseline(
  scopedSorted: ScopedSession[],
  projectPath?: string,
): BaselineModel | null {
  const scope = scopeKey(projectPath)
  const existing = getActiveBaseline(scope)
  if (existing) return existing
  const used = selectBaselineSamples(scopedSorted)
  const model = fitBaseline(used.map((s) => ({ difficulty: s.difficulty, tokens: s.tokens })))
  if (!model) return null
  saveBaseline(scope, model, used)
  return model
}

// Explicit user re-baseline over a chosen set of sessions. Refits + freezes.
export function rebaseline(used: ScopedSession[], projectPath?: string): BaselineModel | null {
  const model = fitBaseline(used.map((s) => ({ difficulty: s.difficulty, tokens: s.tokens })))
  if (!model) return null
  saveBaseline(scopeKey(projectPath), model, used)
  return model
}
```

- [ ] **Step 4: Run, expect PASS** (pure test) + typecheck

Run: `pnpm test -- src/main/services/productivity/baseline.test.ts`
Expected: PASS.
Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/productivity/baseline.ts src/main/services/productivity/baseline.test.ts
git commit -m "feat(kpi): baseline selection + freeze/load/refit service"
```

---

## Task 5: Router — shared КПД rows helper

Add a helper that loads all scoped sessions with last-turn day/ts, ensures the baseline, and computes per-session КПД. Used by `kpi`, `ecosystemImpact`, and `rebaseline`.

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Add imports** near the top of `src/main/trpc/routers/productivity.ts`:

```typescript
import { kpiBaseline } from '@main/db/schema' // add kpiBaseline to existing schema import
import {
  type ScopedSession,
  ensureBaseline,
  rebaseline as refitBaseline,
  scopeKey,
} from '@main/services/productivity/baseline'
import { expectedTokens, kpdByDay, sessionKpd } from '@shared/kpi'
```

(Merge `kpiBaseline` into the existing `@main/db/schema` import line; merge the `@shared/kpi` names into any existing `@shared/kpi` import.)

- [ ] **Step 2: Add the helper** after the existing `sessionEfficiencyMap` function:

```typescript
interface KpdRow extends ScopedSession {
  day: string
  kpd: number | null
}

// Every scoped session with its last-turn day/ts, plus КПД against the frozen
// baseline. Ascending by lastTs. Shared by kpi / ecosystemImpact / rebaseline.
function scopedKpdRows(projectPath?: string): KpdRow[] {
  const tracked = trackedProjects()
  const scopeFilter = projectPath
    ? eq(agentSessions.projectPath, projectPath)
    : tracked.length
      ? inArray(agentSessions.projectPath, tracked)
      : undefined

  // last-turn ts + local day per session
  const turnAgg = db()
    .select({
      id: agentTurns.sessionId,
      lastTs: sql<number>`max(${agentTurns.ts})`,
      day: sql<string>`date(max(${agentTurns.ts}) / 1000, 'unixepoch', 'localtime')`,
    })
    .from(agentTurns)
    .groupBy(agentTurns.sessionId)
    .all()
  const aggById = new Map(turnAgg.map((r) => [r.id, r]))

  const sessRows = db()
    .select({
      id: agentSessions.sessionId,
      difficulty: agentSessions.difficulty,
      score: agentSessions.score,
      tin: agentSessions.totalTokensIn,
      tout: agentSessions.totalTokensOut,
    })
    .from(agentSessions)
    .where(scopeFilter)
    .all()

  const rows: ScopedSession[] = sessRows.flatMap((r) => {
    const agg = aggById.get(r.id)
    if (!agg) return []
    return [
      {
        id: r.id,
        difficulty: r.difficulty,
        tokens: r.tin + r.tout,
        score: r.score,
        lastTs: Number(agg.lastTs),
      },
    ]
  })
  rows.sort((a, b) => a.lastTs - b.lastTs)

  const model = ensureBaseline(rows, projectPath)
  return rows.map((r) => {
    const agg = aggById.get(r.id)
    const kpd = model ? sessionKpd(expectedTokens(model, r.difficulty), r.tokens) : null
    return { ...r, day: agg?.day ?? '', kpd }
  })
}
```

- [ ] **Step 3: Typecheck** (helper currently unused → ensure no errors)

Run: `pnpm typecheck`
Expected: PASS. (Biome may warn `scopedKpdRows`/imports unused — that is fixed in Task 6 which uses them. If `pnpm lint` fails the commit on unused vars, proceed directly to Task 6 and commit them together. Otherwise commit now.)

- [ ] **Step 4: Commit** (only if lint passes with the unused helper; else fold into Task 6)

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(kpi): shared scopedKpdRows helper in productivity router"
```

---

## Task 6: Router — rewrite `kpi` procedure

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Replace the `kpi` procedure** with the version below. Output gains `quality` per day; `byDay.tokens` is kept.

```typescript
  // КПД per day (% vs frozen baseline) + quality guardrail + overall mean.
  kpi: publicProcedure
    .input(rangeInput.extend({ projectPath: z.string().optional() }))
    .output(
      z.object({
        byDay: z.array(
          z.object({
            date: z.string(),
            kpi: z.number(),
            quality: z.number().nullable(),
            sessions: z.number(),
            tokens: z.number(),
          }),
        ),
        overall: z.number().nullable(),
      }),
    )
    .query(({ input }) => {
      const cutoff = cutoffDate(input.days).getTime()
      const rows = scopedKpdRows(input.projectPath).filter(
        (r) => r.lastTs >= cutoff && r.kpd != null,
      )
      if (rows.length === 0) return { byDay: [], overall: null }

      const days = kpdByDay(rows.map((r) => ({ day: r.day, kpd: r.kpd as number, score: r.score })))

      // attach per-day token totals (kpdByDay does not carry tokens)
      const tokByDay = new Map<string, number>()
      for (const r of rows) tokByDay.set(r.day, (tokByDay.get(r.day) ?? 0) + r.tokens)
      const byDay = days.map((d) => ({ ...d, tokens: tokByDay.get(d.date) ?? 0 }))

      const overall = mean(rows.map((r) => r.kpd as number))
      return { byDay, overall }
    })
```

- [ ] **Step 2: Typecheck + run all tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. (The old `kpiByDay`/`kpiCoefficient`/`rawEfficiency` are still present and exported; they are simply no longer used by `kpi`.)

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(kpi): rewrite kpi procedure on frozen-baseline КПД + quality"
```

---

## Task 7: Router — rewrite `ecosystemImpact` to new КПД + quality delta

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Replace the `ecosystemImpact` procedure**. Keep token-per-turn columns; replace KPI before/after with КПД means from `scopedKpdRows`; add `qualityDelta`.

```typescript
  // Before/after impact of each ecosystem change: token/turn, КПД, quality.
  ecosystemImpact: publicProcedure
    .input(z.object({ window: z.number().int().positive().default(7) }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          ts: z.date(),
          type: z.string(),
          target: z.string().nullable(),
          source: z.string().nullable(),
          note: z.string().nullable(),
          tokPerTurnBefore: z.number().nullable(),
          tokPerTurnAfter: z.number().nullable(),
          tokPerTurnDeltaPct: z.number().nullable(),
          kpiBefore: z.number().nullable(),
          kpiAfter: z.number().nullable(),
          kpiDeltaPct: z.number().nullable(),
          qualityDelta: z.number().nullable(),
        }),
      ),
    )
    .query(({ input }) => {
      const w = input.window * 24 * 60 * 60 * 1000
      const changes = db()
        .select()
        .from(ecosystemChanges)
        .where(gte(ecosystemChanges.ts, cutoffDate(60)))
        .orderBy(desc(ecosystemChanges.ts))
        .all()
      if (changes.length === 0) return []

      const earliest = Math.min(...changes.map((c) => c.ts.getTime())) - w
      const turns = db()
        .select({ ts: agentTurns.ts, tin: agentTurns.tokensIn, tout: agentTurns.tokensOut })
        .from(agentTurns)
        .where(and(gte(agentTurns.ts, new Date(earliest)), trackedCondition()))
        .all()

      const kpdRows = scopedKpdRows().filter((r) => r.kpd != null)

      return changes.map((c) => {
        const cTime = c.ts.getTime()
        const before = turns.filter((t) => t.ts.getTime() >= cTime - w && t.ts.getTime() < cTime)
        const after = turns.filter((t) => t.ts.getTime() >= cTime && t.ts.getTime() < cTime + w)
        const tokBefore = before.length ? mean(before.map((t) => t.tin + t.tout)) : null
        const tokAfter = after.length ? mean(after.map((t) => t.tin + t.tout)) : null
        const tokDelta =
          tokBefore && tokAfter ? ((tokAfter - tokBefore) / tokBefore) * 100 : null

        const inWin = (lo: number, hi: number) =>
          kpdRows.filter((r) => r.lastTs >= lo && r.lastTs < hi)
        const beforeRows = inWin(cTime - w, cTime)
        const afterRows = inWin(cTime, cTime + w)

        const kpiBefore = mean(beforeRows.map((r) => r.kpd as number))
        const kpiAfter = mean(afterRows.map((r) => r.kpd as number))
        const kpiDelta = kpiBefore && kpiAfter ? ((kpiAfter - kpiBefore) / kpiBefore) * 100 : null

        const qBefore = mean(
          beforeRows.flatMap((r) => (r.score == null ? [] : [r.score])),
        )
        const qAfter = mean(afterRows.flatMap((r) => (r.score == null ? [] : [r.score])))
        const qualityDelta = qBefore != null && qAfter != null ? qAfter - qBefore : null

        return {
          id: c.id,
          ts: c.ts,
          type: c.type,
          target: c.target,
          source: c.source,
          note: c.note,
          tokPerTurnBefore: tokBefore,
          tokPerTurnAfter: tokAfter,
          tokPerTurnDeltaPct: tokDelta,
          kpiBefore,
          kpiAfter,
          kpiDeltaPct: kpiDelta,
          qualityDelta,
        }
      })
    })
```

- [ ] **Step 2: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(kpi): ecosystemImpact uses КПД + quality delta"
```

---

## Task 8: Router — `setDifficulty`, `rebaseline`, extend `sessions`

**Files:**
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Add `difficulty` to the `sessions` procedure output and select**

In the `sessions` procedure: add `difficulty: z.number().int().nullable()` to the output object; add `difficulty: agentSessions.difficulty` to the `.select({...})`; add `difficulty: r.difficulty` to the returned map object.

- [ ] **Step 2: Add `setDifficulty` mutation** (after `setRating`):

```typescript
  // Set/clear the user's manual task-difficulty override (1–10).
  setDifficulty: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        difficulty: z.number().int().min(1).max(10).nullable(),
      }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      db()
        .update(agentSessions)
        .set({
          difficulty: input.difficulty,
          difficultySource: input.difficulty == null ? null : 'manual',
        })
        .where(eq(agentSessions.sessionId, input.sessionId))
        .run()
      return { ok: true }
    }),
```

- [ ] **Step 3: Add `rebaseline` mutation** (after `setDifficulty`):

```typescript
  // Re-freeze the baseline over a chosen date range. The only operation that
  // intentionally shifts historical КПД. scope = projectPath or global.
  rebaseline: publicProcedure
    .input(
      z.object({
        projectPath: z.string().optional(),
        start: z.date(),
        end: z.date(),
      }),
    )
    .output(z.object({ ok: z.boolean(), method: z.string().nullable() }))
    .mutation(({ input }) => {
      const used = scopedKpdRows(input.projectPath).filter(
        (r) => r.lastTs >= input.start.getTime() && r.lastTs <= input.end.getTime(),
      )
      const model = refitBaseline(
        used.map((r) => ({
          id: r.id,
          difficulty: r.difficulty,
          tokens: r.tokens,
          score: r.score,
          lastTs: r.lastTs,
        })),
        input.projectPath,
      )
      return { ok: model != null, method: model?.method ?? null }
    }),
```

Note: `scopedKpdRows` calls `ensureBaseline`, which is fine — a baseline already existing is left as-is; `refitBaseline` then writes a NEW latest row that `getActiveBaseline` will prefer.

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/trpc/routers/productivity.ts
git commit -m "feat(kpi): setDifficulty + rebaseline mutations, difficulty in sessions"
```

---

## Task 9: Remove dead percentile-KPI code

Now nothing references the old efficiency/KPI functions. Remove them and their tests.

**Files:**
- Modify: `src/shared/kpi.ts`
- Modify: `src/shared/kpi.test.ts`
- Modify: `src/main/trpc/routers/productivity.ts`

- [ ] **Step 1: Delete from `src/shared/kpi.ts`:** `UNRATED_SCORE`, `rawEfficiency`, `kpiCoefficient`, the local `mean` used only by `kpiCoefficient`, the OLD `KpiDaySession`/`KpiDay` interfaces, and the OLD `kpiByDay`. Update the file's top comment to describe the new model. Keep: `BaselineModel`/`fitBaseline`/`expectedTokens`/`sessionKpd`/`kpdByDay` and their types.

- [ ] **Step 2: Delete from `src/shared/kpi.test.ts`** the describe blocks for `UNRATED_SCORE`, `rawEfficiency`, `kpiCoefficient`, and the OLD `kpiByDay`. Remove now-unused imports. Keep the new blocks (fitBaseline, expectedTokens, sessionKpd, kpdByDay).

- [ ] **Step 3: Delete from `src/main/trpc/routers/productivity.ts`** the now-unused `sessionEfficiencyMap` function and any import of `rawEfficiency`/`kpiCoefficient`/old `kpiByDay` from `@shared/kpi`. Keep `sessionComplexityMap` (still used by `sessions`).

- [ ] **Step 4: Typecheck + lint + tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS, no unused-symbol lint errors.

- [ ] **Step 5: Commit**

```bash
git add src/shared/kpi.ts src/shared/kpi.test.ts src/main/trpc/routers/productivity.ts
git commit -m "refactor(kpi): remove dead percentile-KPI code"
```

---

## Task 10: UI — dual-line chart (КПД + quality) + 100% reference

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

- [ ] **Step 1: Update `KpiTooltip`** to show quality. In the `payload` type add `quality: number | null` to the row shape, and add a quality row to the rendered tooltip:

```typescript
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Quality</span>
        <span className="tabular-nums">{row.quality == null ? '—' : row.quality.toFixed(1)}</span>
      </div>
```

- [ ] **Step 2: Update `OverviewTab` chart data + chart** so the КПД query's `quality` flows in and a second line renders on a right axis with a 100% reference line. Replace the `kpiChartData` mapping and the `<LineChart>` block:

```tsx
  const kpiChartData = kpiDates.map((date) => ({
    date,
    kpi: kpiByDate.get(date)?.kpi ?? null,
    quality: kpiByDate.get(date)?.quality ?? null,
    sessions: kpiByDate.get(date)?.sessions ?? 0,
    event: ecoMap.get(date)?.label ?? null,
  }))
```

```tsx
    <LineChart data={kpiChartData} width={800} height={300}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="date" />
      <YAxis yAxisId="kpi" domain={[0, 'auto']} tickFormatter={(v) => `${v}%`} />
      <YAxis yAxisId="quality" orientation="right" domain={[0, 10]} />
      <ReferenceLine yAxisId="kpi" y={100} stroke="var(--color-muted-foreground)" strokeDasharray="4 4" />
      <Line
        yAxisId="kpi"
        type="monotone"
        dataKey="kpi"
        stroke="var(--color-chart-1)"
        connectNulls
        dot={false}
        isAnimationActive={false}
      />
      <Line
        yAxisId="quality"
        type="monotone"
        dataKey="quality"
        stroke="var(--color-chart-2)"
        strokeDasharray="5 3"
        connectNulls
        dot={false}
        isAnimationActive={false}
      />
      <Tooltip content={<KpiTooltip />} />
      <EcoMarkers events={ecoDays.data ?? []} />
    </LineChart>
```

Ensure `XAxis`, `YAxis`, `ReferenceLine` are imported from `recharts` (add any missing to the existing recharts import). Per memory note `[[recharts-v3-overlay-markers]]`, keep `EcoMarkers` using `useXAxisScale`/`usePlotArea` — do not convert it to `ReferenceLine`. The `ReferenceLine` here is a horizontal constant line, which is safe.

- [ ] **Step 3: Verify the app builds**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(kpi): dual-line КПД + quality chart with 100% reference"
```

---

## Task 11: UI — difficulty control + re-baseline button

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

- [ ] **Step 1: Add a `DifficultyControl`** mirroring `RatingControl` (place next to it):

```tsx
function DifficultyControl({
  sessionId,
  difficulty,
}: {
  sessionId: string
  difficulty: number | null
}) {
  const utils = trpc.useUtils()
  const setDifficulty = trpc.productivity.setDifficulty.useMutation({
    onSuccess: async () => {
      await utils.productivity.invalidate()
    },
    onError: () => toast.error('Failed to save difficulty'),
  })
  return (
    <select
      aria-label={`Task difficulty for session ${sessionId}`}
      className="rounded border bg-background px-1 py-0.5 text-sm tabular-nums"
      value={difficulty ?? ''}
      disabled={setDifficulty.isPending}
      onChange={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value)
        setDifficulty.mutate({ sessionId, difficulty: v })
      }}
    >
      <option value="">—</option>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  )
}
```

- [ ] **Step 2: Render it in the sessions table.** In the row that renders `RatingControl`, add an adjacent cell/column `<DifficultyControl sessionId={row.sessionId} difficulty={row.difficulty} />` and add a matching header (e.g. "Difficulty"). The `sessions` query now returns `difficulty` (Task 8).

- [ ] **Step 3: Add a "Re-baseline" button** in `OverviewTab`, near the chart:

```tsx
  const rebaseline = trpc.productivity.rebaseline.useMutation({
    onSuccess: async (r) => {
      toast.success(r.ok ? `Re-baselined (${r.method})` : 'Not enough data to baseline')
      await utils.productivity.invalidate()
    },
    onError: () => toast.error('Re-baseline failed'),
  })
```

```tsx
  <button
    type="button"
    className="rounded border px-2 py-1 text-xs"
    disabled={rebaseline.isPending}
    onClick={() =>
      rebaseline.mutate({
        projectPath,
        start: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
        end: new Date(),
      })
    }
  >
    Re-baseline ({days}d)
  </button>
```

Add `const utils = trpc.useUtils()` in `OverviewTab` if not already present.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(kpi): difficulty control + re-baseline button"
```

---

## Task 12: Settings flag for LLM difficulty estimation

**Files:**
- Modify: `src/shared/settings.ts`

- [ ] **Step 1: Add the flag** to `AppSettings` and `DEFAULT_SETTINGS`:

```typescript
export interface AppSettings {
  outputDir: string
  trackedProjectPaths: string[]
  estimateDifficulty: boolean // LLM-estimate task difficulty at ingest (off by default)
}

export const DEFAULT_SETTINGS: AppSettings = {
  outputDir: '',
  trackedProjectPaths: [],
  estimateDifficulty: false,
}
```

(If `AppSettings` has more fields than shown in the reference, ADD `estimateDifficulty` without removing existing fields.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/shared/settings.ts
git commit -m "feat(kpi): estimateDifficulty setting (default off)"
```

---

## Task 13: LLM difficulty estimator (isolated, gated)

**Files:**
- Create: `src/main/services/productivity/difficulty.ts`

> **Implementer note:** Use the already-installed `@anthropic-ai/claude-agent-sdk` (auth comes from the user's Claude Code session — no API key needed). Before writing the call, open `node_modules/@anthropic-ai/claude-agent-sdk` and confirm the exact `query` export signature (it returns an async iterable of messages). Adapt the parsing below to the real message shape. The function MUST be failure-tolerant: any error or unparseable output → return `null`.

- [ ] **Step 1: Implement** `src/main/services/productivity/difficulty.ts`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'

const RUBRIC = `You rate the intrinsic difficulty of a software task from the FIRST user request only.
Rate 1–10 based on what was ASKED, not how it was done.
1–2 trivial (typo, rename). 3–4 small (one function/file). 5–6 moderate (feature across a few files).
7–8 hard (cross-cutting change, tricky logic). 9–10 very hard (architecture, deep debugging, research).
Reply with ONLY the integer.`

// Estimate intrinsic task difficulty (1–10) from the first user prompt.
// Returns null on any failure or unparseable output. Never throws.
export async function estimateDifficulty(firstPrompt: string): Promise<number | null> {
  const text = firstPrompt.trim().slice(0, 4000)
  if (!text) return null
  try {
    let out = ''
    for await (const msg of query({
      prompt: `${RUBRIC}\n\n---\nTASK REQUEST:\n${text}`,
      options: { maxTurns: 1 },
    })) {
      // Concatenate assistant text content; adapt to the SDK's actual message shape.
      const m = msg as { type?: string; message?: { content?: unknown } }
      const content = m.message?.content
      if (Array.isArray(content)) {
        for (const b of content) {
          const block = b as { type?: string; text?: string }
          if (block.type === 'text' && block.text) out += block.text
        }
      } else if (typeof content === 'string') {
        out += content
      }
    }
    const match = out.match(/\b([1-9]|10)\b/)
    if (!match) return null
    const n = Number(match[1])
    return n >= 1 && n <= 10 ? n : null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. If the `query` import path or option names differ, fix per the installed SDK's types until it compiles.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/productivity/difficulty.ts
git commit -m "feat(kpi): LLM difficulty estimator (gated, failure-tolerant)"
```

---

## Task 14: Capture first user prompt during transcript parse

**Files:**
- Modify: `src/main/services/productivity/transcript.ts`

- [ ] **Step 1: Expose the first user prompt text per session.** Add a helper that extracts the first real user prompt's text from transcript lines (reuse the existing `isRealUserPrompt`):

```typescript
// The text of the first real user prompt in a transcript (the original ask),
// or '' if none. Used for difficulty estimation.
export function firstUserPrompt(lines: unknown[]): string {
  for (const raw of lines) {
    const line = raw as { type?: string; message?: { content?: unknown } }
    if (!isRealUserPrompt(line)) continue
    const content = line.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .filter((b) => (b as { type?: string }).type === 'text')
        .map((b) => (b as { text?: string }).text ?? '')
        .join('\n')
    }
    return ''
  }
  return ''
}
```

(If `isRealUserPrompt` is not exported, export it so this function — or ingest — can reuse it.)

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/productivity/transcript.ts
git commit -m "feat(kpi): extract first user prompt per transcript"
```

---

## Task 15: Wire estimator into ingest (gated)

**Files:**
- Modify: `src/main/services/productivity/ingest.ts`

> **Implementer note:** Read the current `ingest.ts` carefully first — confirm how transcripts map to sessions and where `sessionRows` are built, so first-prompt text can be associated by `sessionId`. The estimation step is async, runs only when `getSettings().estimateDifficulty` is true, and only for sessions whose stored `difficulty` is currently null (so manual overrides and prior estimates are never clobbered).

- [ ] **Step 1: After `writeRows`, add a gated estimation pass** in `ingestAll` (or as a dedicated exported function called from `ingestAll`):

```typescript
import { getSettings } from '@main/store'
import { agentSessions } from '@main/db/schema'
import { estimateDifficulty } from '@main/services/productivity/difficulty'
import { firstUserPrompt } from '@main/services/productivity/transcript'
import { and, eq, isNull } from 'drizzle-orm'

// firstPromptBySession: Map<sessionId, string> built while reading transcripts
async function estimateMissingDifficulties(
  database: AppDatabase,
  firstPromptBySession: Map<string, string>,
): Promise<void> {
  if (!getSettings().estimateDifficulty) return
  const missing = database
    .select({ id: agentSessions.sessionId })
    .from(agentSessions)
    .where(isNull(agentSessions.difficulty))
    .all()
  for (const { id } of missing) {
    const prompt = firstPromptBySession.get(id)
    if (!prompt) continue
    const d = await estimateDifficulty(prompt)
    if (d == null) continue
    database
      .update(agentSessions)
      .set({ difficulty: d, difficultySource: 'llm' })
      .where(and(eq(agentSessions.sessionId, id), isNull(agentSessions.difficulty)))
      .run()
  }
}
```

- [ ] **Step 2: Build `firstPromptBySession`** in `collectIngestRows` (while iterating transcripts, call `firstUserPrompt(lines)` and key it by the session id of the file's turns), thread it through `IngestRows`, and call `estimateMissingDifficulties(database, rows.firstPromptBySession)` at the end of `ingestAll`.

- [ ] **Step 3: Typecheck + tests + lint**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/productivity/ingest.ts
git commit -m "feat(kpi): estimate missing difficulties at ingest when enabled"
```

---

## Final verification

- [ ] **Run the full suite:** `pnpm typecheck && pnpm lint && pnpm test`
- [ ] **Launch the app** (`pnpm dev`) and confirm: the Productivity Overview shows the КПД line with a 100% reference and a quality line; the sessions table has a working difficulty dropdown; the ecosystem impact table shows КПД before/after and quality delta; "Re-baseline" works.
- [ ] КПД appears even with all difficulties null (global-median baseline) — verifying the metric works without the LLM phase.

---

## Self-Review (author checklist — completed)

**Spec coverage:**
- Formula `expectedTokens(difficulty)/actualTokens×100` → Tasks 2, 5, 6.
- Difficulty hybrid (LLM + manual override) → Tasks 8 (manual), 12–15 (LLM, gated).
- Difficulty intrinsic (from request, not scope) → Task 14 (first prompt), 13 (rubric).
- Frozen baseline + no history mutation → Task 4 (freeze/load), Task 5 (`ensureBaseline` writes once).
- Both views: cumulative line + before/after table → Tasks 6, 7.
- Quality as separate guardrail line, unrated excluded, no 5.5 imputation → Tasks 3, 6, 9, 10.
- Remove percentile ranking + 5.5 + scope-in-numerator → Task 9.
- global-median fallback so metric works without difficulty → Tasks 2, 6, Final verification.
- Re-baseline (only intentional history shift) → Tasks 4, 8, 11.
- Edge cases (tokens ≤ 0, null difficulty, sparse baseline) → Task 2 tests.

**Placeholder scan:** No TBD/TODO; all code blocks complete. SDK-shape and ingest-wiring carry explicit "read the source first" implementer notes rather than vague instructions, with concrete code to adapt.

**Type consistency:** `BaselineModel`/`BaselineParams`/`ScopedSession`/`KpdDaySession`/`KpdDay` names consistent across kpi.ts ↔ baseline.ts ↔ router. `scopedKpdRows` returns `kpd: number | null`; consumers filter `r.kpd != null` then cast `as number`. `kpdByDay` field is `kpi` (mean КПД) matching the chart `dataKey="kpi"`.

**Open spec questions resolved by decision:** difficulty rubric anchors (Task 13), baseline floor = max(15, 25%) (Task 4), КПД line = raw daily mean (no rolling), display cap deferred (YAxis `domain={[0,'auto']}` handles range).
