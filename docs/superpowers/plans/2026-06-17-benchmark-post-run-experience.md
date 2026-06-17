# Benchmark Post-Run Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a benchmark batch, fill results live, fire a native notification, retry transient failures, auto-explain the A/B infra effect in 2-3 sentences, and let the user discuss that conclusion in an in-app chat.

**Architecture:** Backend changes live in `src/main/services/benchmark/*` (run loop, pure aggregation/analysis helpers) plus a new `benchmarkChat` service that reuses the existing skill-improver streaming pattern (mailbox + streaming `query()` + tRPC subscription + Zustand store + App-level host). A new `benchmark_analysis` table persists the latest conclusion. Renderer changes are confined to `Productivity.tsx` (live refetch, analysis card, Discuss button), a new store, host, and overlay.

**Tech Stack:** Electron main + better-sqlite3 + Drizzle ORM; tRPC (+ `observable` subscriptions); `@anthropic-ai/claude-agent-sdk`; React + Zustand + sonner; vitest; biome.

## Global Constraints

- All UI strings and agent prompts in **English** (only generated digest content may be Russian). [from project memory `ui-strings-always-english`]
- Do **not** retry `assertion_failed` or `rate_limited` runs — they are real signals. Retry sweep covers `timeout` and `sdk_error` only. [spec]
- Parallel run execution is **out of scope and forbidden** — it destroys cache-read/wall-time measurement. [spec / knowledge `benchmark-measurement-bias`]
- Force OAuth in every spawned SDK call by stripping `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from env. [existing `runner.ts` / `run.ts` pattern]
- New DB tables require a generated migration: edit `src/main/db/schema.ts`, then run `pnpm db:generate` and commit the new `drizzle/*.sql` file. Migrations apply on app boot via `runMigrations()`.
- Run `pnpm test` for unit tests, `pnpm lint` (biome) and `pnpm typecheck` before each commit. Commit messages: author your own (the `git-commit-message` skill misfires in this repo — ignore it). End commit bodies with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Do **not** `git push` (user pushes himself).
- Root tRPC router file: `src/main/trpc/routers/index.ts`. App-level hosts mounted in `src/renderer/src/App.tsx`.

---

## File Structure

**New files:**
- `src/main/services/llm/subscriptionEnv.ts` — shared OAuth-forcing env helper (new code only; existing duplicates left untouched).
- `src/main/services/benchmark/aggregate.ts` — `summarizeRuns`, `buildAbSlice` + types `RawRun`, `SummaryRow`, `AbRow`.
- `src/main/services/benchmark/aggregate.test.ts`
- `src/main/services/benchmark/sweep.ts` — `selectTransientFailures` predicate.
- `src/main/services/benchmark/sweep.test.ts`
- `src/main/services/benchmark/analysis.ts` — `buildAnalysisPrompt`, `runAnalysis`.
- `src/main/services/benchmark/analysis.test.ts` — prompt builder only.
- `src/main/services/benchmarkChat/run.ts` — `startBenchmarkChat`.
- `src/main/services/benchmarkChat/seed.ts` — `buildChatSeed`.
- `src/main/services/benchmarkChat/seed.test.ts`
- `src/main/trpc/routers/benchmarkChat.ts` — `.start`/`.reply`/`.cancel`.
- `src/renderer/src/store/benchmarkChatRun.ts` — Zustand store.
- `src/renderer/src/components/BenchmarkChatHost.tsx` — App-level subscription host.
- `src/renderer/src/components/BenchmarkChatOverlay.tsx` — chat overlay UI.

**Modified files:**
- `src/main/db/schema.ts` — add `benchmark_analysis` table + row types.
- `drizzle/<generated>.sql` — new migration (auto-generated).
- `src/main/services/benchmark/batch.ts` — `Progress.phase`, retry sweep, analysis step, native notification.
- `src/main/services/benchmark/compare.ts` — `wipeBenchmarkRuns` also clears `benchmark_analysis`.
- `src/main/trpc/routers/benchmark.ts` — `progressShape` gains `phase`; refactor `results` to use `summarizeRuns`; add `latestAnalysis` + `reanalyze`.
- `src/main/trpc/routers/index.ts` — register `benchmarkChat` router.
- `src/shared/ipc-events.ts` — add `BenchmarkChatEvent`.
- `src/renderer/src/App.tsx` — mount `<BenchmarkChatHost />`.
- `src/renderer/src/pages/Productivity.tsx` — live `results` refetch while running; completion toast; analysis card + Discuss button; render overlay.

---

## PHASE A — Live results, notification, retry sweep

### Task A1: Shared OAuth env helper

**Files:**
- Create: `src/main/services/llm/subscriptionEnv.ts`

**Interfaces:**
- Produces: `subscriptionEnv(): Record<string, string>`

- [ ] **Step 1: Create the helper**

```typescript
// src/main/services/llm/subscriptionEnv.ts
// Strip metered API keys so spawned SDK calls use the user's Pro/Max OAuth.
// Mirrors the local copies in benchmark/runner.ts and skillImprover/run.ts; new
// code imports this shared version instead of re-declaring it.
export function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS (no usages yet).

- [ ] **Step 3: Commit**

```bash
git add src/main/services/llm/subscriptionEnv.ts
git commit -m "feat(benchmark): shared subscriptionEnv helper for OAuth-forced SDK calls"
```

---

### Task A2: A/B aggregation helper

**Files:**
- Create: `src/main/services/benchmark/aggregate.ts`
- Test: `src/main/services/benchmark/aggregate.test.ts`

**Interfaces:**
- Consumes: `summarize`, `TaskInfraSummary`, `compare`, `Delta`, `RepMetric` from `@main/services/benchmark/stats`; `InfraState` from `@main/services/productivity/infra`.
- Produces:
  - `RawRun` — `{ taskId, infraHash, model, tokensIn, tokensOut, cacheReadTokens, cacheCreationTokens, totalCostUsd, success, ts: Date, infraSnapshot: InfraState }`
  - `SummaryRow` — `TaskInfraSummary & { model: string; firstTs: number; snapshot: InfraState }`
  - `AbRow` — `{ taskId: string; beforeInfraHash: string; afterInfraHash: string; tokens: Delta; output: Delta; cost: Delta }`
  - `summarizeRuns(rows: RawRun[]): SummaryRow[]`
  - `buildAbSlice(summaries: SummaryRow[]): AbRow[]`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/services/benchmark/aggregate.test.ts
import { buildAbSlice, summarizeRuns, type RawRun } from '@main/services/benchmark/aggregate'
import type { InfraState } from '@main/services/productivity/infra'
import { describe, expect, it } from 'vitest'

const snap: InfraState = { plugins: {}, mcpActive: [], mcpDisabled: [], skills: {} }

const run = (
  taskId: string,
  infraHash: string,
  tokensIn: number,
  tokensOut: number,
  tsMs: number,
  success = true,
): RawRun => ({
  taskId,
  infraHash,
  model: 'm',
  tokensIn,
  tokensOut,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalCostUsd: 0,
  success,
  ts: new Date(tsMs),
  infraSnapshot: snap,
})

describe('summarizeRuns', () => {
  it('groups by task+infra+model and medians the successful reps', () => {
    const rows = [
      run('t1', 'A', 100, 10, 1000),
      run('t1', 'A', 300, 10, 2000),
      run('t1', 'A', 0, 0, 1500, false), // failed rep excluded
    ]
    const out = summarizeRuns(rows)
    expect(out).toHaveLength(1)
    expect(out[0].taskId).toBe('t1')
    expect(out[0].infraHash).toBe('A')
    expect(out[0].n).toBe(2)
    expect(out[0].medianTokens).toBe(210) // (110 + 310) / 2
    expect(out[0].firstTs).toBe(1000)
  })
})

describe('buildAbSlice', () => {
  it('pairs each task latest infra variant against the previous one', () => {
    const summaries = summarizeRuns([
      run('t1', 'A', 100, 10, 1000),
      run('t1', 'B', 200, 20, 2000),
    ])
    const slice = buildAbSlice(summaries)
    expect(slice).toHaveLength(1)
    expect(slice[0]).toMatchObject({ taskId: 't1', beforeInfraHash: 'A', afterInfraHash: 'B' })
    expect(slice[0].tokens.before).toBe(110)
    expect(slice[0].tokens.after).toBe(220)
    expect(slice[0].tokens.pctDelta).toBeCloseTo(100, 5)
  })

  it('skips tasks with only one infra variant', () => {
    const slice = buildAbSlice(summarizeRuns([run('t1', 'A', 100, 10, 1000)]))
    expect(slice).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/benchmark/aggregate.test.ts`
Expected: FAIL — cannot find module `aggregate`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/services/benchmark/aggregate.ts
import {
  compare,
  type Delta,
  type RepMetric,
  summarize,
  type TaskInfraSummary,
} from '@main/services/benchmark/stats'
import type { InfraState } from '@main/services/productivity/infra'

// Minimal shape of a benchmark_runs row the aggregation needs. Keeping it narrow
// (not the full Drizzle row) makes the helpers pure and trivially testable.
export interface RawRun {
  taskId: string
  infraHash: string
  model: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalCostUsd: number
  success: boolean
  ts: Date
  infraSnapshot: InfraState
}

export interface SummaryRow extends TaskInfraSummary {
  model: string
  firstTs: number
  snapshot: InfraState
}

// One task's A/B step: the latest infra variant (after) vs the one before it.
export interface AbRow {
  taskId: string
  beforeInfraHash: string
  afterInfraHash: string
  tokens: Delta
  output: Delta
  cost: Delta
}

function toRep(r: RawRun): RepMetric {
  return {
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    cacheReadTokens: r.cacheReadTokens,
    cacheCreationTokens: r.cacheCreationTokens,
    totalCostUsd: r.totalCostUsd,
    success: r.success,
  }
}

// Group runs by (task, infra, model) and median the successful reps. Single
// source of truth for the results table and the analyzer.
export function summarizeRuns(rows: RawRun[]): SummaryRow[] {
  const groups = new Map<string, RawRun[]>()
  for (const r of rows) {
    const key = `${r.taskId}::${r.infraHash}::${r.model}`
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }
  const out: SummaryRow[] = []
  for (const g of groups.values()) {
    out.push({
      ...summarize(g[0].taskId, g[0].infraHash, g.map(toRep)),
      model: g[0].model,
      firstTs: Math.min(...g.map((r) => r.ts.getTime())),
      snapshot: g[0].infraSnapshot,
    })
  }
  return out
}

// For each task, order its infra variants by time and pair the LAST against the
// one immediately before it (the A/B step the UI shows). Tasks with <2 variants
// have no step and are skipped.
export function buildAbSlice(summaries: SummaryRow[]): AbRow[] {
  const byTask = new Map<string, SummaryRow[]>()
  for (const s of summaries) {
    const arr = byTask.get(s.taskId) ?? []
    arr.push(s)
    byTask.set(s.taskId, arr)
  }
  const out: AbRow[] = []
  for (const arr of byTask.values()) {
    if (arr.length < 2) continue
    const sorted = [...arr].sort((a, b) => a.firstTs - b.firstTs)
    const before = sorted[sorted.length - 2]
    const after = sorted[sorted.length - 1]
    out.push({
      taskId: after.taskId,
      beforeInfraHash: before.infraHash,
      afterInfraHash: after.infraHash,
      tokens: compare(after.taskId, before.medianTokens, after.medianTokens),
      output: compare(after.taskId, before.medianOutputTokens, after.medianOutputTokens),
      cost: compare(after.taskId, before.medianCostUsd, after.medianCostUsd),
    })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/benchmark/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/benchmark/aggregate.ts src/main/services/benchmark/aggregate.test.ts
git commit -m "feat(benchmark): pure A/B aggregation helper (summarizeRuns, buildAbSlice)"
```

---

### Task A3: Transient-failure selector

**Files:**
- Create: `src/main/services/benchmark/sweep.ts`
- Test: `src/main/services/benchmark/sweep.test.ts`

**Interfaces:**
- Produces: `selectTransientFailures<T extends { success: boolean; failReason: string | null }>(rows: T[]): T[]`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/services/benchmark/sweep.test.ts
import { selectTransientFailures } from '@main/services/benchmark/sweep'
import { describe, expect, it } from 'vitest'

const row = (success: boolean, failReason: string | null) => ({ success, failReason })

describe('selectTransientFailures', () => {
  it('selects only failed timeout/sdk_error rows', () => {
    const rows = [
      row(true, null),
      row(false, 'timeout'),
      row(false, 'sdk_error'),
      row(false, 'assertion_failed'),
      row(false, 'rate_limited'),
    ]
    const out = selectTransientFailures(rows)
    expect(out).toEqual([row(false, 'timeout'), row(false, 'sdk_error')])
  })

  it('never selects a successful row even if failReason is set', () => {
    expect(selectTransientFailures([row(true, 'timeout')])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/benchmark/sweep.test.ts`
Expected: FAIL — cannot find module `sweep`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/services/benchmark/sweep.ts
// Transient = a technical hiccup worth one more attempt. assertion_failed and
// rate_limited are real signals about the run and are deliberately NOT retried.
const TRANSIENT = new Set(['timeout', 'sdk_error'])

export function selectTransientFailures<T extends { success: boolean; failReason: string | null }>(
  rows: T[],
): T[] {
  return rows.filter((r) => !r.success && r.failReason !== null && TRANSIENT.has(r.failReason))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/benchmark/sweep.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/benchmark/sweep.ts src/main/services/benchmark/sweep.test.ts
git commit -m "feat(benchmark): selectTransientFailures predicate for retry sweep"
```

---

### Task A4: Run-loop — phase field, retry sweep, native notification

**Files:**
- Modify: `src/main/services/benchmark/batch.ts`

**Interfaces:**
- Consumes: `selectTransientFailures` (A3); `eq` from `drizzle-orm`; `Notification` from `electron`.
- Produces: `Progress` gains `phase: 'running' | 'retrying' | 'analyzing' | 'done'`.

- [ ] **Step 1: Extend the `Progress` interface and initial value**

In `src/main/services/benchmark/batch.ts`, change the `Progress` interface (around line 17-24) to add `phase`:

```typescript
export interface Progress {
  batchId: string
  total: number
  done: number
  failed: number
  running: boolean
  phase: 'running' | 'retrying' | 'analyzing' | 'done'
  error: string | null
}
```

In `startBatch` (around line 53), set the initial phase:

```typescript
  const progress: Progress = {
    batchId,
    total,
    done: 0,
    failed: 0,
    running: true,
    phase: 'running',
    error: null,
  }
```

- [ ] **Step 2: Add imports**

At the top of `batch.ts`, update the electron import and add `eq`:

```typescript
import { eq } from 'drizzle-orm'
import { app, Notification } from 'electron'
```

(Replace the existing `import { app } from 'electron'` line.)

Add the sweep import alongside the other benchmark imports:

```typescript
import { selectTransientFailures } from '@main/services/benchmark/sweep'
```

- [ ] **Step 3: Add the retry sweep after the main loop**

In `runLoop`, immediately AFTER the `for (const task of tasks)` loop closes (after line ~122, before the `} catch` of the outer try) insert:

```typescript
    // Retry sweep: transient failures already got one inline retry; give them a
    // single final attempt now that the run is otherwise done (a transient blip
    // may have cleared). REPLACE the row in place so k stays clean.
    progress.phase = 'retrying'
    const tasksById = new Map(tasks.map((t) => [t.id, t]))
    const failedRows = db()
      .select()
      .from(benchmarkRuns)
      .where(eq(benchmarkRuns.batchId, batchId))
      .all()
    for (const row of selectTransientFailures(failedRows)) {
      const task = tasksById.get(row.taskId)
      if (!task) continue
      const retry = await runBenchmarkTask(task, { model, repoRoot })
      db()
        .update(benchmarkRuns)
        .set({
          ts: new Date(),
          tokensIn: retry.tokensIn,
          tokensOut: retry.tokensOut,
          cacheReadTokens: retry.cacheReadTokens,
          cacheCreationTokens: retry.cacheCreationTokens,
          totalCostUsd: retry.totalCostUsd,
          numTurns: retry.numTurns,
          durationMs: retry.durationMs,
          success: retry.success,
          failReason: retry.failReason,
          transcriptPath: retry.sessionId,
        })
        .where(eq(benchmarkRuns.id, row.id))
        .run()
    }
    // Recompute failed count after the sweep.
    progress.failed = db()
      .select()
      .from(benchmarkRuns)
      .where(eq(benchmarkRuns.batchId, batchId))
      .all()
      .filter((r) => !r.success).length
```

- [ ] **Step 4: Add native notification in `finally`**

Replace the `finally` block of `runLoop` (around line 126-128) with:

```typescript
  } finally {
    progress.running = false
    progress.phase = 'done'
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Benchmark done',
          body: `${progress.done}/${progress.total} runs · ${progress.failed} failed`,
        }).show()
      }
    } catch {
      // Notifications are best-effort; never let one break batch teardown.
    }
  }
```

- [ ] **Step 5: Update the tRPC progress schema**

In `src/main/trpc/routers/benchmark.ts`, add `phase` to `progressShape` (around line 31-40):

```typescript
const progressShape = z
  .object({
    batchId: z.string(),
    total: z.number(),
    done: z.number(),
    failed: z.number(),
    running: z.boolean(),
    phase: z.enum(['running', 'retrying', 'analyzing', 'done']),
    error: z.string().nullable(),
  })
  .nullable()
```

- [ ] **Step 6: Verify build**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (the `getProgress`/`getLatest` return type now includes `phase`; no test references the old shape).

- [ ] **Step 7: Commit**

```bash
git add src/main/services/benchmark/batch.ts src/main/trpc/routers/benchmark.ts
git commit -m "feat(benchmark): retry sweep for transient failures + phase + completion notification"
```

---

### Task A5: Live results + phase label in the UI

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

**Interfaces:**
- Consumes: `running` / `liveProgress.phase` from the existing progress queries.

- [ ] **Step 1: Refetch results live while a batch runs**

In `BenchmarkTab` (Productivity.tsx ~1943), change the `results` query so it polls every 2s while a batch is running. Because `running` is computed below the query, drive the interval off the in-flight progress queries via a ref-free approach: replace

```typescript
  const results = trpc.benchmark.results.useQuery()
```

with

```typescript
  // Poll while a batch is in flight so the table fills in run-by-run (each run
  // is persisted immediately by the main process). Falls back to manual
  // invalidation on completion (effect below) for the final refresh.
  const results = trpc.benchmark.results.useQuery(undefined, {
    refetchInterval: (query) => {
      const live = query.client.getQueryData<unknown>
      return undefined // placeholder replaced in step 2
    },
  })
```

(We finalize the interval in Step 2 once `running` is in scope — see note.)

- [ ] **Step 2: Drive the interval off `running` cleanly**

Simplest correct wiring: keep `results` a plain query and add a polling effect that invalidates it on a timer while running. Replace the Step 1 edit with the plain query again:

```typescript
  const results = trpc.benchmark.results.useQuery()
```

Then, directly after the existing completion effect (Productivity.tsx ~1978-1983), add:

```typescript
  // While running, refresh the results table on the same 2s cadence as progress
  // so rows appear as each run lands instead of all-at-once at the end.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => void utils.benchmark.results.invalidate(), 2000)
    return () => clearInterval(id)
  }, [running, utils])
```

- [ ] **Step 3: Show the current phase in the progress line**

In the live-progress `<span>` (Productivity.tsx ~2055-2060), replace the trailing `' · running…'` text with a phase-aware label:

```tsx
            {liveProgress ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-3)' }}>
                {liveProgress.done}/{liveProgress.total} done · {liveProgress.failed} failed
                {liveProgress.running ? ` · ${liveProgress.phase}…` : ''}
              </span>
            ) : null}
```

- [ ] **Step 4: Verify build + manual check**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS.

Manual: `pnpm dev`, open Productivity → benchmark tab, start a small batch (set reps = 1, and temporarily it's fine to run the full task set or a subset). Confirm rows appear progressively, the label cycles `running… → retrying… → analyzing… → done`, and a desktop notification fires at the end.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(benchmark): live results refetch + phase label while a batch runs"
```

---

## PHASE B — Auto-analysis

### Task B1: `benchmark_analysis` table + migration

**Files:**
- Modify: `src/main/db/schema.ts`
- Create: `drizzle/<generated>.sql` (via `pnpm db:generate`)
- Modify: `src/main/services/benchmark/compare.ts`

**Interfaces:**
- Produces: `benchmarkAnalysis` table; `BenchmarkAnalysisRow`, `NewBenchmarkAnalysisRow`.

- [ ] **Step 1: Add the table to the schema**

In `src/main/db/schema.ts`, after the `benchmarkRuns` table definition (after line 162), add:

```typescript
// One row per completed batch's auto-analysis. The UI reads the newest row, so
// it behaves as "replaced each batch". `dataJson` is the A/B slice the summary
// was based on; it also seeds the discuss-chat. `summary` is null when the
// analysis call failed.
export const benchmarkAnalysis = sqliteTable(
  'benchmark_analysis',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    model: text('model').notNull(),
    infraHash: text('infra_hash').notNull(),
    baselineInfraHash: text('baseline_infra_hash'),
    summary: text('summary'),
    dataJson: text('data_json', { mode: 'json' })
      .$type<import('@main/services/benchmark/aggregate').AbRow[]>()
      .notNull(),
  },
  (t) => [index('idx_bench_analysis_created').on(t.createdAt)],
)

export type BenchmarkAnalysisRow = typeof benchmarkAnalysis.$inferSelect
export type NewBenchmarkAnalysisRow = typeof benchmarkAnalysis.$inferInsert
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file `drizzle/0006_*.sql` containing `CREATE TABLE \`benchmark_analysis\``. Inspect it to confirm.

- [ ] **Step 3: Clear analysis on wipe**

In `src/main/services/benchmark/compare.ts`, add the import and extend `wipeBenchmarkRuns` (lines 16, 47-55):

Add to the schema import:

```typescript
import { benchmarkAnalysis, benchmarkRuns } from '@main/db/schema'
```

Change the wipe to also clear analyses:

```typescript
export async function wipeBenchmarkRuns(): Promise<{ deleted: number }> {
  const result = db().delete(benchmarkRuns).run()
  db().delete(benchmarkAnalysis).run()
  try {
    await unlink(baselineMarkerPath())
  } catch {
    // marker may not exist — fine
  }
  return { deleted: result.changes ?? 0 }
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/db/schema.ts drizzle/ src/main/services/benchmark/compare.ts
git commit -m "feat(benchmark): benchmark_analysis table + wipe cleanup"
```

---

### Task B2: Analysis prompt builder + one-shot runner

**Files:**
- Create: `src/main/services/benchmark/analysis.ts`
- Test: `src/main/services/benchmark/analysis.test.ts`

**Interfaces:**
- Consumes: `AbRow` (A2); `subscriptionEnv` (A1).
- Produces:
  - `buildAnalysisPrompt(slice: AbRow[]): string`
  - `runAnalysis(opts: { slice: AbRow[]; model: string; repoRoot: string; timeoutMs?: number }): Promise<string | null>`

- [ ] **Step 1: Write the failing test (prompt builder only)**

```typescript
// src/main/services/benchmark/analysis.test.ts
import type { AbRow } from '@main/services/benchmark/aggregate'
import { buildAnalysisPrompt } from '@main/services/benchmark/analysis'
import { describe, expect, it } from 'vitest'

const delta = (before: number, after: number) => ({
  taskId: 't1',
  before,
  after,
  absDelta: after - before,
  pctDelta: before === 0 ? Number.NaN : ((after - before) / before) * 100,
})

const slice: AbRow[] = [
  {
    taskId: 't1',
    beforeInfraHash: 'A',
    afterInfraHash: 'B',
    tokens: delta(1000, 800),
    output: delta(100, 90),
    cost: delta(0.1, 0.08),
  },
]

describe('buildAnalysisPrompt', () => {
  it('includes the task, the token delta, and a 2-3 sentence instruction', () => {
    const p = buildAnalysisPrompt(slice)
    expect(p).toContain('t1')
    expect(p).toContain('-20.0%') // token pctDelta
    expect(p).toMatch(/2-3 sentence/i)
    expect(p).toMatch(/plain language/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/benchmark/analysis.test.ts`
Expected: FAIL — cannot find module `analysis`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/services/benchmark/analysis.ts
import type { AbRow } from '@main/services/benchmark/aggregate'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'

const TIMEOUT_MS = 2 * 60_000

function fmtPct(pct: number): string {
  if (Number.isNaN(pct)) return 'n/a'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

// Render the A/B slice as a compact table and ask for a short plain-language
// read of what the infra change did. Kept pure so it is unit-testable.
export function buildAnalysisPrompt(slice: AbRow[]): string {
  const lines = slice.map(
    (r) =>
      `- ${r.taskId}: total tokens ${fmtPct(r.tokens.pctDelta)} (${Math.round(r.tokens.before)} → ${Math.round(r.tokens.after)}), output ${fmtPct(r.output.pctDelta)}, cost ${fmtPct(r.cost.pctDelta)}`,
  )
  return [
    'You are analyzing an A/B benchmark of a Claude Code "infra" change (CLAUDE.md, MCP servers, skills).',
    'Each line compares the latest infra variant (after) against the previous one (before) for one fixed task. Negative percentages mean the new infra is cheaper/smaller; positive means more expensive.',
    '',
    'Per-task deltas:',
    ...lines,
    '',
    'In 2-3 sentences of plain language, explain the overall effect of this infra change: did it make tasks cheaper, more expensive, or mixed, and where the biggest shifts are. Do not list every task; summarize. Output only the sentences, no preamble.',
  ].join('\n')
}

// One-shot, single-turn, NO tools. Returns the model's text, or null on failure
// (timeout / non-success / empty). Never throws — the caller persists null.
export async function runAnalysis(opts: {
  slice: AbRow[]
  model: string
  repoRoot: string
  timeoutMs?: number
}): Promise<string | null> {
  if (opts.slice.length === 0) return null
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS)
  let text = ''
  try {
    const q = query({
      prompt: buildAnalysisPrompt(opts.slice),
      options: {
        model: opts.model,
        allowedTools: [],
        permissionMode: 'bypassPermissions' as const,
        settingSources: [] as ('user' | 'project')[],
        cwd: opts.repoRoot,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    for await (const message of q) {
      if (message.type === 'result' && message.subtype === 'success') {
        text = message.result
      }
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/benchmark/analysis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/benchmark/analysis.ts src/main/services/benchmark/analysis.test.ts
git commit -m "feat(benchmark): A/B analysis prompt builder + one-shot runner"
```

---

### Task B3: Wire analysis into the run loop

**Files:**
- Modify: `src/main/services/benchmark/batch.ts`

**Interfaces:**
- Consumes: `summarizeRuns`, `buildAbSlice` (A2); `runAnalysis` (B2); `benchmarkAnalysis` table (B1).

- [ ] **Step 1: Add imports**

In `batch.ts`, add:

```typescript
import { benchmarkAnalysis, benchmarkRuns } from '@main/db/schema'
import { buildAbSlice, summarizeRuns } from '@main/services/benchmark/aggregate'
import { runAnalysis } from '@main/services/benchmark/analysis'
```

(Merge the `benchmarkAnalysis` into the existing `benchmarkRuns` import line.)

- [ ] **Step 2: Add the analysis step after the retry sweep**

In `runLoop`, AFTER the retry-sweep block (end of Task A4 Step 3) and still inside the outer `try`, add:

```typescript
    // Auto-analysis: explain the A/B effect of this infra change in 2-3 plain
    // sentences. Isolated try/catch — a failed analysis must NOT mark the batch
    // errored; we persist a null-summary row instead so the UI can offer retry.
    progress.phase = 'analyzing'
    try {
      const allRows = db().select().from(benchmarkRuns).all()
      const slice = buildAbSlice(
        summarizeRuns(
          allRows.map((r) => ({
            taskId: r.taskId,
            infraHash: r.infraHash,
            model: r.model,
            tokensIn: r.tokensIn,
            tokensOut: r.tokensOut,
            cacheReadTokens: r.cacheReadTokens,
            cacheCreationTokens: r.cacheCreationTokens,
            totalCostUsd: r.totalCostUsd,
            success: r.success,
            ts: r.ts,
            infraSnapshot: r.infraSnapshot,
          })),
        ),
      )
      const summary = slice.length > 0 ? await runAnalysis({ slice, model, repoRoot }) : null
      db()
        .insert(benchmarkAnalysis)
        .values({
          id: randomUUID(),
          batchId,
          createdAt: new Date(),
          model,
          infraHash,
          baselineInfraHash: slice[0]?.beforeInfraHash ?? null,
          summary,
          dataJson: slice,
        })
        .run()
    } catch (err) {
      console.error('[benchmark] analysis step failed:', err)
      db()
        .insert(benchmarkAnalysis)
        .values({
          id: randomUUID(),
          batchId,
          createdAt: new Date(),
          model,
          infraHash,
          baselineInfraHash: null,
          summary: null,
          dataJson: [],
        })
        .run()
    }
```

- [ ] **Step 3: Verify build**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/benchmark/batch.ts
git commit -m "feat(benchmark): run A/B auto-analysis at end of batch and persist it"
```

---

### Task B4: `latestAnalysis` + `reanalyze` tRPC procedures

**Files:**
- Modify: `src/main/trpc/routers/benchmark.ts`

**Interfaces:**
- Produces: `benchmark.latestAnalysis` query → `{ batchId, createdAt, model, summary, dataJson } | null`; `benchmark.reanalyze` mutation → `{ ok: boolean }`.

- [ ] **Step 1: Add imports**

In `benchmark.ts`, add to the existing imports:

```typescript
import { app } from 'electron'
import { desc } from 'drizzle-orm'
import { benchmarkAnalysis, benchmarkRuns } from '@main/db/schema'
import { buildAbSlice, summarizeRuns } from '@main/services/benchmark/aggregate'
import { runAnalysis } from '@main/services/benchmark/analysis'
import { repoCommit } from '@main/services/benchmark/runner'
import { randomUUID } from 'node:crypto'
```

(Merge `benchmarkAnalysis` into the existing `benchmarkRuns` import. `repoCommit` import is only needed if not already present — `app.getAppPath()` gives the repo root; we don't actually need `repoCommit` here, omit it if unused.)

- [ ] **Step 2: Add a shared abRow output shape**

Near the other `z.object` shapes at the top of the file, add:

```typescript
const deltaShape = z.object({
  taskId: z.string(),
  before: z.number(),
  after: z.number(),
  absDelta: z.number(),
  pctDelta: z.number(),
})

const abRowShape = z.object({
  taskId: z.string(),
  beforeInfraHash: z.string(),
  afterInfraHash: z.string(),
  tokens: deltaShape,
  output: deltaShape,
  cost: deltaShape,
})
```

- [ ] **Step 3: Add the two procedures**

Inside `benchmarkRouter`, after `results` (before `infraCompare`), add:

```typescript
  latestAnalysis: publicProcedure
    .output(
      z
        .object({
          batchId: z.string(),
          createdAt: z.number(),
          model: z.string(),
          summary: z.string().nullable(),
          dataJson: z.array(abRowShape),
        })
        .nullable(),
    )
    .query(() => {
      const row = db()
        .select()
        .from(benchmarkAnalysis)
        .orderBy(desc(benchmarkAnalysis.createdAt))
        .limit(1)
        .get()
      if (!row) return null
      return {
        batchId: row.batchId,
        createdAt: row.createdAt.getTime(),
        model: row.model,
        summary: row.summary,
        dataJson: row.dataJson,
      }
    }),

  // Recompute the analysis from current data and persist a fresh row. Used by
  // the "analysis unavailable" retry button. Derives model/infra from the most
  // recent run.
  reanalyze: publicProcedure
    .output(z.object({ ok: z.boolean() }))
    .mutation(async () => {
      const rows = db().select().from(benchmarkRuns).all()
      if (rows.length === 0) return { ok: false }
      const newest = rows.reduce((a, b) => (a.ts.getTime() >= b.ts.getTime() ? a : b))
      const slice = buildAbSlice(
        summarizeRuns(
          rows.map((r) => ({
            taskId: r.taskId,
            infraHash: r.infraHash,
            model: r.model,
            tokensIn: r.tokensIn,
            tokensOut: r.tokensOut,
            cacheReadTokens: r.cacheReadTokens,
            cacheCreationTokens: r.cacheCreationTokens,
            totalCostUsd: r.totalCostUsd,
            success: r.success,
            ts: r.ts,
            infraSnapshot: r.infraSnapshot,
          })),
        ),
      )
      const summary =
        slice.length > 0
          ? await runAnalysis({ slice, model: newest.model, repoRoot: app.getAppPath() })
          : null
      db()
        .insert(benchmarkAnalysis)
        .values({
          id: randomUUID(),
          batchId: newest.batchId,
          createdAt: new Date(),
          model: newest.model,
          infraHash: newest.infraHash,
          baselineInfraHash: slice[0]?.beforeInfraHash ?? null,
          summary,
          dataJson: slice,
        })
        .run()
      return { ok: summary !== null }
    }),
```

- [ ] **Step 4: Verify build**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS. (If `repoCommit` import is unused, remove it — biome will flag it.)

- [ ] **Step 5: Commit**

```bash
git add src/main/trpc/routers/benchmark.ts
git commit -m "feat(benchmark): latestAnalysis query + reanalyze mutation"
```

---

### Task B5: Analysis card in the UI

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

**Interfaces:**
- Consumes: `trpc.benchmark.latestAnalysis`, `trpc.benchmark.reanalyze`.

- [ ] **Step 1: Query the latest analysis and invalidate it on completion**

In `BenchmarkTab`, after the `results` query (~1943) add:

```typescript
  const analysis = trpc.benchmark.latestAnalysis.useQuery()
  const reanalyze = trpc.benchmark.reanalyze.useMutation({
    onSuccess: () => void utils.benchmark.latestAnalysis.invalidate(),
  })
```

In the existing completion effect (~1978-1983), add the analysis invalidation:

```typescript
  useEffect(() => {
    if (liveProgress && !liveProgress.running) {
      void utils.benchmark.results.invalidate()
      void utils.benchmark.infraCompare.invalidate()
      void utils.benchmark.latestAnalysis.invalidate()
    }
  }, [liveProgress, utils])
```

- [ ] **Step 2: Render the analysis card**

Directly after the closing `</div>` of the "run benchmark" panel (Productivity.tsx ~2076, before `<InfraComparePanel />`), insert:

```tsx
      {analysis.data ? (
        <div className="panel mt-16">
          <div className="panel-head">
            <span className="ttl">analysis</span>
            <span className="meta">plain-language read of the latest A/B infra change</span>
          </div>
          <div className="panel-body">
            {analysis.data.summary ? (
              <>
                <p style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--fg-1)' }}>
                  {analysis.data.summary}
                </p>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: 12 }}
                  onClick={() => useBenchmarkChatRun.getState().start(analysis.data!.batchId)}
                >
                  DISCUSS
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-3)' }}>
                  analysis unavailable
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={reanalyze.isPending}
                  onClick={() => reanalyze.mutate()}
                >
                  {reanalyze.isPending ? 'RETRYING…' : 'RETRY ANALYSIS'}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
```

- [ ] **Step 3: Import the chat store (created in Phase C)**

> Note: this import depends on Task C4. If executing strictly in order, add the import in C5 and leave the DISCUSS `onClick` commented until then. If Phase C is already done, add now:

At the top of `Productivity.tsx`:

```typescript
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
```

- [ ] **Step 4: Verify build**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS (once C4 exists; otherwise temporarily stub the import per the note).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(benchmark): analysis card with summary + discuss/retry actions"
```

---

## PHASE C — Discuss chat

### Task C1: `BenchmarkChatEvent` + chat seed builder

**Files:**
- Modify: `src/shared/ipc-events.ts`
- Create: `src/main/services/benchmarkChat/seed.ts`
- Test: `src/main/services/benchmarkChat/seed.test.ts`

**Interfaces:**
- Produces:
  - `BenchmarkChatEvent` union (token / tool / awaiting-input / done / error / aborted).
  - `buildChatSeed(summary: string | null, slice: AbRow[]): string`

- [ ] **Step 1: Add the event type**

In `src/shared/ipc-events.ts`, append:

```typescript
// Events streamed from main → renderer during a benchmark-discussion chat
// (tRPC subscription). Mirrors the improver shape minus accept/reject/report.
export type BenchmarkChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'awaiting-input' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
```

- [ ] **Step 2: Write the failing seed test**

```typescript
// src/main/services/benchmarkChat/seed.test.ts
import type { AbRow } from '@main/services/benchmark/aggregate'
import { buildChatSeed } from '@main/services/benchmarkChat/seed'
import { describe, expect, it } from 'vitest'

const slice: AbRow[] = [
  {
    taskId: 't1',
    beforeInfraHash: 'A',
    afterInfraHash: 'B',
    tokens: { taskId: 't1', before: 1000, after: 800, absDelta: -200, pctDelta: -20 },
    output: { taskId: 't1', before: 100, after: 90, absDelta: -10, pctDelta: -10 },
    cost: { taskId: 't1', before: 0.1, after: 0.08, absDelta: -0.02, pctDelta: -20 },
  },
]

describe('buildChatSeed', () => {
  it('embeds the summary and the per-task data and invites discussion', () => {
    const seed = buildChatSeed('It got cheaper.', slice)
    expect(seed).toContain('It got cheaper.')
    expect(seed).toContain('t1')
    expect(seed).toContain('-20.0%')
    expect(seed).toMatch(/read-only/i)
  })

  it('handles a null summary', () => {
    const seed = buildChatSeed(null, slice)
    expect(seed).toMatch(/no automated summary/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/benchmarkChat/seed.test.ts`
Expected: FAIL — cannot find module `seed`.

- [ ] **Step 4: Write the implementation**

```typescript
// src/main/services/benchmarkChat/seed.ts
import type { AbRow } from '@main/services/benchmark/aggregate'

function fmtPct(pct: number): string {
  if (Number.isNaN(pct)) return 'n/a'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

// The opening user message for the discussion session. Gives the model the
// auto-analysis conclusion plus the underlying A/B table, and tells it the repo
// is available read-only for follow-up digging.
export function buildChatSeed(summary: string | null, slice: AbRow[]): string {
  const table = slice.map(
    (r) =>
      `- ${r.taskId}: total tokens ${fmtPct(r.tokens.pctDelta)} (${Math.round(r.tokens.before)} → ${Math.round(r.tokens.after)}), output ${fmtPct(r.output.pctDelta)}, cost ${fmtPct(r.cost.pctDelta)}`,
  )
  return [
    'We just finished an A/B benchmark of a Claude Code infra change (CLAUDE.md, MCP servers, skills). Each row compares the latest infra variant against the previous one for one fixed task.',
    '',
    summary
      ? `Automated summary: ${summary}`
      : 'There is no automated summary for this run (analysis failed).',
    '',
    'Per-task A/B deltas:',
    ...table,
    '',
    'I want to discuss these results with you. You have read-only access to this repository (Read, Grep, Glob) if you need to inspect code or transcripts to explain a result. Start by briefly confirming you have the data, then ask what I want to dig into.',
  ].join('\n')
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/benchmarkChat/seed.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-events.ts src/main/services/benchmarkChat/seed.ts src/main/services/benchmarkChat/seed.test.ts
git commit -m "feat(benchmark-chat): BenchmarkChatEvent type + chat seed builder"
```

---

### Task C2: `startBenchmarkChat` streaming driver

**Files:**
- Create: `src/main/services/benchmarkChat/run.ts`

**Interfaces:**
- Consumes: `createMailbox` from `@main/services/skillImprover/mailbox` (generic, already exported); `subscriptionEnv` (A1); `BenchmarkChatEvent` (C1).
- Produces: `startBenchmarkChat(opts: { requestId: string; seed: string; model: string; repoRoot: string; emit: (e: BenchmarkChatEvent) => void }): { reply: (text: string) => void; cancel: () => void; done: Promise<void> }`

- [ ] **Step 1: Write the driver**

```typescript
// src/main/services/benchmarkChat/run.ts
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@main/logger'
import { createMailbox, type Mailbox } from '@main/services/skillImprover/mailbox'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import type { BenchmarkChatEvent } from '@shared/ipc-events'

// Read-only tools: the chat may inspect code/transcripts but must never mutate
// the live repo.
const CHAT_TOOLS = ['Read', 'Grep', 'Glob']

export interface BenchmarkChatRun {
  reply: (text: string) => void
  cancel: () => void
  done: Promise<void>
}

export interface StartBenchmarkChatOptions {
  requestId: string
  seed: string
  model: string
  repoRoot: string
  emit: (event: BenchmarkChatEvent) => void
}

// Interactive discussion session over benchmark results. Streaming-input mode:
// the session stays open across turns until the mailbox is closed by cancel.
export function startBenchmarkChat(opts: StartBenchmarkChatOptions): BenchmarkChatRun {
  const controller = new AbortController()
  let queryRef: Query | null = null
  let mailbox: Mailbox | null = null
  let stopped = false

  const done = (async (): Promise<void> => {
    mailbox = createMailbox(opts.seed)
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt: mailbox.stream,
      options: {
        model: opts.model,
        allowedTools: CHAT_TOOLS,
        permissionMode: 'bypassPermissions',
        settingSources: ['user', 'project'],
        includePartialMessages: true,
        cwd: opts.repoRoot,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    queryRef = q

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          opts.emit({ type: 'token', text: event.delta.text })
        }
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            opts.emit({ type: 'tool', name: block.name, summary: summarizeTool(block) })
          }
        }
      } else if (message.type === 'result') {
        if (stopped) continue
        if (message.subtype === 'success') {
          opts.emit({ type: 'awaiting-input' })
        } else {
          const reason = message.errors?.join('; ') || message.subtype
          opts.emit({ type: 'error', message: `Chat run failed: ${reason}` })
        }
      }
    }
  })().catch((error) => {
    if (stopped) return
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Benchmark chat failed', message)
    opts.emit({ type: 'error', message })
  })

  return {
    reply: (text: string) => mailbox?.push(text),
    cancel: () => {
      if (stopped) return
      stopped = true
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      void done.then(() => opts.emit({ type: 'aborted' }))
    },
    done,
  }
}

function summarizeTool(block: { name: string; input: unknown }): string {
  const input = block.input as Record<string, unknown> | undefined
  if (!input) return block.name
  const hint =
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.pattern === 'string' && input.pattern) ||
    (typeof input.command === 'string' && input.command) ||
    ''
  const text = String(hint).slice(0, 80)
  return text ? `${block.name}: ${text}` : block.name
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/benchmarkChat/run.ts
git commit -m "feat(benchmark-chat): streaming discussion driver (read-only tools)"
```

---

### Task C3: `benchmarkChat` tRPC router

**Files:**
- Create: `src/main/trpc/routers/benchmarkChat.ts`
- Modify: `src/main/trpc/routers/index.ts`

**Interfaces:**
- Consumes: `startBenchmarkChat` (C2); `buildChatSeed` (C1); `benchmarkAnalysis` table (B1); `getSettings`, `DEFAULT_MODEL_ID`.
- Produces: `benchmarkChat.start` (subscription, input `{ requestId, batchId }`), `.reply`, `.cancel`.

- [ ] **Step 1: Write the router**

```typescript
// src/main/trpc/routers/benchmarkChat.ts
import { randomUUID } from 'node:crypto'
import { db } from '@main/db/client'
import { benchmarkAnalysis } from '@main/db/schema'
import { logger } from '@main/logger'
import { type BenchmarkChatRun, startBenchmarkChat } from '@main/services/benchmarkChat/run'
import { buildChatSeed } from '@main/services/benchmarkChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { BenchmarkChatEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { app } from 'electron'
import { z } from 'zod'

const runs = new Map<string, BenchmarkChatRun>()

export const benchmarkChatRouter = router({
  start: publicProcedure
    .input(z.object({ requestId: z.string().min(1), batchId: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<BenchmarkChatEvent>((emit) => {
        const analysis = db()
          .select()
          .from(benchmarkAnalysis)
          .where(eq(benchmarkAnalysis.batchId, input.batchId))
          .get()
        if (!analysis) {
          emit.next({ type: 'error', message: 'No analysis found for this batch' })
          emit.complete()
          return
        }
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const seed = buildChatSeed(analysis.summary, analysis.dataJson)
        const run = startBenchmarkChat({
          requestId: input.requestId,
          seed,
          model,
          repoRoot: app.getAppPath(),
          emit: (event) => {
            if (event.type === 'error' || event.type === 'aborted') {
              logger.info('Benchmark chat ended', { type: event.type })
            }
            emit.next(event)
          },
        })
        runs.set(input.requestId, run)
        return () => {
          const r = runs.get(input.requestId)
          if (r) {
            r.cancel()
            runs.delete(input.requestId)
          }
        }
      }),
    ),

  reply: publicProcedure
    .input(z.object({ requestId: z.string().min(1), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.reply(input.text)
      return { ok: Boolean(run) }
    }),

  cancel: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.cancel()
      runs.delete(input.requestId)
      return { ok: Boolean(run) }
    }),
})
```

- [ ] **Step 2: Register the router**

In `src/main/trpc/routers/index.ts`, add the import and the router entry:

```typescript
import { benchmarkChatRouter } from '@main/trpc/routers/benchmarkChat'
```

```typescript
  benchmark: benchmarkRouter,
  benchmarkChat: benchmarkChatRouter,
```

- [ ] **Step 3: Verify build**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/benchmarkChat.ts src/main/trpc/routers/index.ts
git commit -m "feat(benchmark-chat): tRPC router (start/reply/cancel) seeded from analysis"
```

---

### Task C4: Renderer store

**Files:**
- Create: `src/renderer/src/store/benchmarkChatRun.ts`

**Interfaces:**
- Produces: `useBenchmarkChatRun` Zustand store with `start(batchId)`, `appendToken`, `pushTool`, `pushUserReply`, `flushTurn`, `setAwaiting`, `finish`, `reset`, and state `{ running, requestId, batchId, transcript, streaming, awaitingInput, status }`.

- [ ] **Step 1: Write the store**

```typescript
// src/renderer/src/store/benchmarkChatRun.ts
import { create } from 'zustand'

export interface ChatEntry {
  kind: 'assistant' | 'tool' | 'user'
  text: string
}

// Lives OUTSIDE the Productivity page so the session survives tab switches; the
// subscription is hosted at App level (BenchmarkChatHost).
interface BenchmarkChatState {
  running: boolean
  requestId: string | null
  batchId: string | null
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  status: 'idle' | 'running' | 'done' | 'error' | 'aborted'

  start: (batchId: string) => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

export const useBenchmarkChatRun = create<BenchmarkChatState>((set) => ({
  running: false,
  requestId: null,
  batchId: null,
  transcript: [],
  streaming: '',
  awaitingInput: false,
  status: 'idle',

  start: (batchId) =>
    set({
      running: true,
      requestId: crypto.randomUUID(),
      batchId,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      status: 'running',
    }),

  appendToken: (text) => set((s) => ({ streaming: s.streaming + text, awaitingInput: false })),

  flushTurn: () =>
    set((s) => {
      const text = s.streaming.trimEnd()
      return text.trim()
        ? { transcript: [...s.transcript, { kind: 'assistant', text }], streaming: '' }
        : { streaming: '' }
    }),

  pushTool: (summary) =>
    set((s) => ({ transcript: [...s.transcript, { kind: 'tool', text: summary }] })),

  pushUserReply: (text) =>
    set((s) => ({
      transcript: [...s.transcript, { kind: 'user', text }],
      awaitingInput: false,
    })),

  setAwaiting: (v) => set({ awaitingInput: v }),

  finish: (status) => set({ running: false, awaitingInput: false, status }),

  reset: () =>
    set({
      running: false,
      requestId: null,
      batchId: null,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      status: 'idle',
    }),
}))
```

- [ ] **Step 2: Verify build**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/benchmarkChatRun.ts
git commit -m "feat(benchmark-chat): renderer Zustand store"
```

---

### Task C5: App-level host

**Files:**
- Create: `src/renderer/src/components/BenchmarkChatHost.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `trpc.benchmarkChat.start`; `useBenchmarkChatRun` (C4).

- [ ] **Step 1: Write the host**

```tsx
// src/renderer/src/components/BenchmarkChatHost.tsx
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the benchmark-discussion subscription. Living above
// the page switch means leaving the Productivity tab does not unsubscribe → the
// session keeps going. Renders nothing.
export function BenchmarkChatHost() {
  const running = useBenchmarkChatRun((s) => s.running)
  const requestId = useBenchmarkChatRun((s) => s.requestId)
  const batchId = useBenchmarkChatRun((s) => s.batchId)
  const appendToken = useBenchmarkChatRun((s) => s.appendToken)
  const flushTurn = useBenchmarkChatRun((s) => s.flushTurn)
  const pushTool = useBenchmarkChatRun((s) => s.pushTool)
  const setAwaiting = useBenchmarkChatRun((s) => s.setAwaiting)
  const finish = useBenchmarkChatRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && batchId ? { requestId, batchId } : skipToken),
    [running, requestId, batchId],
  )

  trpc.benchmarkChat.start.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'token':
          appendToken(event.text)
          break
        case 'tool':
          pushTool(event.summary)
          break
        case 'awaiting-input':
          flushTurn()
          setAwaiting(true)
          break
        case 'done':
          flushTurn()
          finish('done')
          break
        case 'error':
          finish('error')
          toast.error(event.message)
          break
        case 'aborted':
          finish('aborted')
          break
      }
    },
    onError: (error) => {
      finish('error')
      toast.error(error.message)
    },
  })

  return null
}
```

- [ ] **Step 2: Mount it in App**

In `src/renderer/src/App.tsx`, add the import:

```typescript
import { BenchmarkChatHost } from '@renderer/components/BenchmarkChatHost'
```

And mount it next to the other hosts (after `<SkillImproverHost />`, ~line 71):

```tsx
      <SkillImproverHost />
      <BenchmarkChatHost />
```

- [ ] **Step 3: Verify build**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/BenchmarkChatHost.tsx src/renderer/src/App.tsx
git commit -m "feat(benchmark-chat): App-level subscription host"
```

---

### Task C6: Chat overlay UI

**Files:**
- Create: `src/renderer/src/components/BenchmarkChatOverlay.tsx`
- Modify: `src/renderer/src/pages/Productivity.tsx`

**Interfaces:**
- Consumes: `useBenchmarkChatRun` (C4); `trpc.benchmarkChat.reply` / `.cancel`.

- [ ] **Step 1: Write the overlay**

```tsx
// src/renderer/src/components/BenchmarkChatOverlay.tsx
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { useEffect, useRef, useState } from 'react'

// Floating discussion panel over the benchmark tab. Reads the App-level store,
// so the session continues even when this overlay is unmounted (tab switch).
export function BenchmarkChatOverlay() {
  const status = useBenchmarkChatRun((s) => s.status)
  const requestId = useBenchmarkChatRun((s) => s.requestId)
  const transcript = useBenchmarkChatRun((s) => s.transcript)
  const streaming = useBenchmarkChatRun((s) => s.streaming)
  const awaitingInput = useBenchmarkChatRun((s) => s.awaitingInput)
  const pushUserReply = useBenchmarkChatRun((s) => s.pushUserReply)
  const reset = useBenchmarkChatRun((s) => s.reset)

  const reply = trpc.benchmarkChat.reply.useMutation()
  const cancel = trpc.benchmarkChat.cancel.useMutation()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  if (status === 'idle') return null

  const send = () => {
    const text = draft.trim()
    if (!text || !requestId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ requestId, text })
    setDraft('')
  }

  const closeChat = () => {
    if (requestId && status === 'running') cancel.mutate({ requestId })
    reset()
  }

  return (
    <div className="bench-chat">
      <div className="bench-chat-head">
        <span className="ttl">discuss results</span>
        <button type="button" className="btn" onClick={closeChat}>
          {status === 'running' ? 'STOP' : 'CLOSE'}
        </button>
      </div>
      <div className="bench-chat-log" ref={logRef}>
        {transcript.map((e, i) => (
          <div key={i} className={`bench-chat-entry ${e.kind}`}>
            {e.kind === 'tool' ? `· ${e.text}` : e.text}
          </div>
        ))}
        {streaming ? <div className="bench-chat-entry assistant">{streaming}</div> : null}
      </div>
      <div className="bench-chat-foot">
        <textarea
          className="input"
          rows={2}
          value={draft}
          placeholder={awaitingInput ? 'Ask about the results…' : 'Model is working…'}
          disabled={!awaitingInput || status !== 'running'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={!awaitingInput || status !== 'running'}
          onClick={send}
        >
          SEND
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add overlay styles**

In `src/renderer/src/index.css`, near the `.improver` styles (~line 1125), add:

```css
.bench-chat {
  position: fixed;
  right: 20px;
  bottom: 20px;
  width: 420px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  z-index: 50;
}
.bench-chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid var(--border);
}
.bench-chat-log {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.bench-chat-entry {
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
}
.bench-chat-entry.user {
  color: var(--fg-1);
  align-self: flex-end;
  background: var(--bg-2);
  padding: 6px 10px;
  border-radius: 6px;
}
.bench-chat-entry.tool {
  color: var(--fg-3);
  font-family: var(--mono);
  font-size: 12px;
}
.bench-chat-entry.assistant {
  color: var(--fg-2);
}
.bench-chat-foot {
  display: flex;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid var(--border);
}
```

> If any CSS variable name above (`--bg-1`, `--bg-2`, `--fg-1/2/3`, `--border`, `--mono`) does not exist in the palette, match the names used by the existing `.improver` / `.panel` rules (grep `index.css` for `.improver` and reuse its tokens).

- [ ] **Step 3: Render the overlay in the benchmark tab**

In `src/renderer/src/pages/Productivity.tsx`, import it:

```typescript
import { BenchmarkChatOverlay } from '@renderer/components/BenchmarkChatOverlay'
```

And render it at the end of `BenchmarkTab`'s returned fragment (just before the closing `</>`):

```tsx
      <BenchmarkChatOverlay />
    </>
```

- [ ] **Step 4: Verify build + manual check**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS.

Manual: `pnpm dev` → benchmark tab. With at least two infra variants of some task already in the DB (run a small batch twice with an infra change between, or reuse existing data), confirm the analysis card shows a summary and **DISCUSS** opens the overlay. Send a message, confirm streamed reply, tool lines for any Read/Grep, and that switching tabs and back keeps the transcript. STOP/CLOSE ends it.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/BenchmarkChatOverlay.tsx src/renderer/src/index.css src/renderer/src/pages/Productivity.tsx
git commit -m "feat(benchmark-chat): discussion overlay UI wired to analysis card"
```

---

## Self-Review Notes

- **Spec coverage:** live results (A5), notification (A4), retry sweep transient-only (A3+A4), auto-analysis A/B + persistence (B1-B4) + card (B5), discuss chat read-only + reuse improver pattern (C1-C6), wipe clears analysis (B1). All spec sections map to a task.
- **Deviation from spec:** the spec proposed refactoring the `results` tRPC query to call the shared helper. This plan extracts `summarizeRuns` (B2/A2 used by the analyzer) but leaves the existing `results` query inline, because it additionally denormalizes plugins/MCP/skills/name and refactoring it carries risk for no functional gain. `buildAbSlice` mirrors the UI's existing prev-variant pairing exactly, satisfying the "same A/B computation" intent. (If a strict single-source refactor is wanted, it's a follow-up.)
- **Type consistency:** `AbRow`/`Delta` shapes used identically across aggregate.ts, analysis.ts, seed.ts, schema.ts (`$type<AbRow[]>`), and the router `abRowShape`. `Progress.phase` enum matches between `batch.ts` and `progressShape`. Store/host/overlay event handling matches `BenchmarkChatEvent`.
- **Ordering note:** Task B5 imports the C4 store. Execute phases in order A → B → C, and add the `useBenchmarkChatRun` import + live DISCUSS handler only once C4 exists (flagged inline in B5 Step 3). Alternatively reorder so C4 lands before B5.
