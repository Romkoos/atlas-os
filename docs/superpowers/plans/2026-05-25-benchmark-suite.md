# Benchmark Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a frozen set of read-only tasks on the real `claude` headless runtime under the current infra, capture token cost stamped with an infra fingerprint, and compare cost across infra versions.

**Architecture:** Pure modules (`fingerprint`, `stats`, `gate`) are TDD unit-tested. `runner.ts` wraps the Claude Agent SDK `query()` (integration-thin). `batch.ts` orchestrates task×rep loops, persists `benchmark_runs` rows, and tracks progress in memory. A new `benchmark` tRPC router exposes run/progress/results. A Benchmark tab in `Productivity.tsx` triggers runs (with a cost-confirm gate) and shows median/spread per task×infra.

**Tech Stack:** TypeScript, Electron main, `@anthropic-ai/claude-agent-sdk`, drizzle-orm + better-sqlite3, tRPC + zod, React + `@trpc/react-query`, vitest, biome, pnpm.

**Design source:** `docs/superpowers/specs/2026-05-25-benchmark-suite-design.md`

**Conventions (project rules):**
- Execute on a feature branch `feat/benchmark-suite`; final task merges `--no-ff` into `main` **locally only** — **DO NOT `git push`** ([[no-push-user-pushes]]).
- **Ignore the Mako `git-commit-message` skill** — wrong repo ([[git-commit-message-skill-wrong-repo]]). Write commit messages directly in harness format with the Co-Authored-By trailer shown in each Commit step.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` must pass before each commit (pre-commit typecheck hook runs anyway).
- DB-touching code is NOT unit-tested: better-sqlite3 is an Electron-ABI native module that can't load under vitest. Only the pure modules get tests.

---

## File Structure

| File | Responsibility | Tested |
|------|----------------|--------|
| `src/main/services/benchmark/types.ts` | Shared types (`Assertion`, `BenchmarkTask`, `RunResult`, `FailReason`) | — |
| `src/main/services/benchmark/gate.ts` | Pure success/validity gate | unit |
| `src/main/services/benchmark/fingerprint.ts` | Pure infra → stable hash | unit |
| `src/main/services/benchmark/stats.ts` | Pure median/spread/summarize/compare | unit |
| `src/main/services/benchmark/tasks.ts` | Frozen curated task fixture | — |
| `src/main/services/benchmark/runner.ts` | `query()` wrapper → `RunResult` | integration |
| `src/main/services/benchmark/batch.ts` | Orchestrate loop, persist rows, progress | integration |
| `src/main/db/schema.ts` (modify) | `benchmark_runs` table | — |
| `drizzle/*.sql` (generated) | Migration | — |
| `src/main/trpc/routers/benchmark.ts` | tRPC: run/progress/results/tasks | — |
| `src/main/trpc/router.ts` (modify) | Register `benchmark` router | — |
| `src/renderer/src/pages/Productivity.tsx` (modify) | Benchmark tab + `BenchmarkTab` component | — |

---

## Task 1: Shared types

**Files:**
- Create: `src/main/services/benchmark/types.ts`

- [ ] **Step 1: Create the types module**

```typescript
// src/main/services/benchmark/types.ts

export interface Assertion {
  type: 'includes' | 'regex'
  value: string
}

export interface BenchmarkTask {
  id: string
  prompt: string
  assert: Assertion
}

export type FailReason = 'sdk_error' | 'assertion_failed' | 'timeout'

export interface RunResult {
  taskId: string
  model: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalCostUsd: number
  numTurns: number
  durationMs: number
  success: boolean
  failReason: FailReason | null
  sessionId: string | null
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck:node`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/main/services/benchmark/types.ts
git commit -m "feat(benchmark): shared types for benchmark suite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Success/validity gate (pure, TDD)

The gate is the defense against the cheap-failure trap: a run that errors early spends few tokens and would otherwise look "efficient". It takes plain fields (not SDK types) so it is trivially unit-testable.

**Files:**
- Create: `src/main/services/benchmark/gate.ts`
- Test: `src/main/services/benchmark/gate.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/services/benchmark/gate.test.ts
import { checkRun, matchesAssertion } from '@main/services/benchmark/gate'
import { describe, expect, it } from 'vitest'

describe('matchesAssertion', () => {
  it('includes match is a case-sensitive substring', () => {
    expect(matchesAssertion('the infra.ts watcher', { type: 'includes', value: 'infra.ts' })).toBe(true)
    expect(matchesAssertion('nothing here', { type: 'includes', value: 'infra.ts' })).toBe(false)
  })
  it('regex match is case-insensitive', () => {
    expect(matchesAssertion('Scope Regression', { type: 'regex', value: 'scope|regression' })).toBe(true)
    expect(matchesAssertion('unrelated text', { type: 'regex', value: 'scope|regression' })).toBe(false)
  })
})

describe('checkRun', () => {
  const assert = { type: 'includes', value: 'infra.ts' } as const
  it('valid when success and assertion matches', () => {
    expect(checkRun({ subtype: 'success', resultText: 'see infra.ts', aborted: false }, assert)).toEqual({
      valid: true,
      failReason: null,
    })
  })
  it('timeout when aborted', () => {
    expect(checkRun({ subtype: 'success', resultText: 'see infra.ts', aborted: true }, assert)).toEqual({
      valid: false,
      failReason: 'timeout',
    })
  })
  it('sdk_error when subtype is not success', () => {
    expect(checkRun({ subtype: 'error_max_turns', resultText: '', aborted: false }, assert)).toEqual({
      valid: false,
      failReason: 'sdk_error',
    })
  })
  it('assertion_failed when success but text does not match', () => {
    expect(checkRun({ subtype: 'success', resultText: 'wrong answer', aborted: false }, assert)).toEqual({
      valid: false,
      failReason: 'assertion_failed',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/benchmark/gate.test.ts`
Expected: FAIL — cannot find module `@main/services/benchmark/gate`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/services/benchmark/gate.ts
import type { Assertion, FailReason } from '@main/services/benchmark/types'

export function matchesAssertion(text: string, assert: Assertion): boolean {
  if (assert.type === 'includes') return text.includes(assert.value)
  return new RegExp(assert.value, 'i').test(text)
}

export interface GateInput {
  subtype: string
  resultText: string
  aborted: boolean
}

export function checkRun(
  input: GateInput,
  assert: Assertion,
): { valid: boolean; failReason: FailReason | null } {
  if (input.aborted) return { valid: false, failReason: 'timeout' }
  if (input.subtype !== 'success') return { valid: false, failReason: 'sdk_error' }
  if (!matchesAssertion(input.resultText, assert)) return { valid: false, failReason: 'assertion_failed' }
  return { valid: true, failReason: null }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/benchmark/gate.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/benchmark/gate.ts src/main/services/benchmark/gate.test.ts
git commit -m "feat(benchmark): success/validity gate with per-task assertion

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Infra fingerprint (pure, TDD)

Reuses `InfraState` (type-only import — erased at compile, so no runtime dependency on `infra.ts` and no DB load under vitest). Property under test: order-independence, and any real add/remove/toggle/edit flips the hash.

**Files:**
- Create: `src/main/services/benchmark/fingerprint.ts`
- Test: `src/main/services/benchmark/fingerprint.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/services/benchmark/fingerprint.test.ts
import { infraFingerprint } from '@main/services/benchmark/fingerprint'
import type { InfraState } from '@main/services/productivity/infra'
import { describe, expect, it } from 'vitest'

const base: InfraState = {
  plugins: { a: true, b: false },
  mcpActive: ['x', 'y'],
  mcpDisabled: ['z'],
  skills: { s1: 1000, s2: 2000 },
}

describe('infraFingerprint', () => {
  it('is order-independent', () => {
    const reordered: InfraState = {
      plugins: { b: false, a: true },
      mcpActive: ['y', 'x'],
      mcpDisabled: ['z'],
      skills: { s2: 2000, s1: 1000 },
    }
    expect(infraFingerprint(reordered)).toBe(infraFingerprint(base))
  })
  it('changes when a plugin is toggled', () => {
    expect(infraFingerprint({ ...base, plugins: { a: false, b: false } })).not.toBe(infraFingerprint(base))
  })
  it('changes when an mcp server is added', () => {
    expect(infraFingerprint({ ...base, mcpActive: ['x', 'y', 'new'] })).not.toBe(infraFingerprint(base))
  })
  it('changes when a skill mtime changes (edit)', () => {
    expect(infraFingerprint({ ...base, skills: { s1: 1000, s2: 9999 } })).not.toBe(infraFingerprint(base))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/benchmark/fingerprint.test.ts`
Expected: FAIL — cannot find module `@main/services/benchmark/fingerprint`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/services/benchmark/fingerprint.ts
import { createHash } from 'node:crypto'
import type { InfraState } from '@main/services/productivity/infra'

export function canonicalInfra(state: InfraState): string {
  const kv = (o: Record<string, boolean | number>): string[] =>
    Object.keys(o)
      .sort()
      .map((k) => `${k}=${o[k]}`)
  return JSON.stringify({
    plugins: kv(state.plugins),
    skills: kv(state.skills),
    mcpActive: [...state.mcpActive].sort(),
    mcpDisabled: [...state.mcpDisabled].sort(),
  })
}

export function infraFingerprint(state: InfraState): string {
  return createHash('sha256').update(canonicalInfra(state)).digest('hex').slice(0, 12)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/benchmark/fingerprint.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/benchmark/fingerprint.ts src/main/services/benchmark/fingerprint.test.ts
git commit -m "feat(benchmark): order-independent infra fingerprint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Aggregation stats (pure, TDD)

`summarize` groups reps for one task×infra; invalid reps excluded before aggregation. `median` is robust to the single cold-cache rep at k=5. `spread` is the IQR (p75−p25).

**Files:**
- Create: `src/main/services/benchmark/stats.ts`
- Test: `src/main/services/benchmark/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/main/services/benchmark/stats.test.ts
import { compare, median, spread, summarize } from '@main/services/benchmark/stats'
import { describe, expect, it } from 'vitest'

describe('median', () => {
  it('odd length returns the middle', () => expect(median([3, 1, 2])).toBe(2))
  it('even length averages the middle two', () => expect(median([1, 2, 3, 4])).toBe(2.5))
})

describe('spread', () => {
  it('is the interquartile range', () => {
    expect(spread([1, 2, 3, 4, 5])).toBeCloseTo(2, 5)
  })
})

describe('summarize', () => {
  it('excludes invalid reps and medians the token totals', () => {
    const s = summarize('t1', 'abc', [
      { tokensIn: 100, tokensOut: 100, totalCostUsd: 0.1, success: true },
      { tokensIn: 300, tokensOut: 100, totalCostUsd: 0.3, success: true },
      { tokensIn: 0, tokensOut: 0, totalCostUsd: 0, success: false },
    ])
    expect(s.n).toBe(2)
    expect(s.medianTokens).toBe(300) // totals 200 and 400 -> 300
  })
})

describe('compare', () => {
  it('computes absolute and percent delta', () => {
    const d = compare('t1', 200, 150)
    expect(d.absDelta).toBe(-50)
    expect(d.pctDelta).toBeCloseTo(-25, 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/benchmark/stats.test.ts`
Expected: FAIL — cannot find module `@main/services/benchmark/stats`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/main/services/benchmark/stats.ts
export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1]
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base])
}

export function spread(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return quantile(s, 0.75) - quantile(s, 0.25)
}

export interface RepMetric {
  tokensIn: number
  tokensOut: number
  totalCostUsd: number
  success: boolean
}

export interface TaskInfraSummary {
  taskId: string
  infraHash: string
  n: number
  medianTokens: number
  spreadTokens: number
  medianCostUsd: number
}

export function summarize(taskId: string, infraHash: string, reps: RepMetric[]): TaskInfraSummary {
  const valid = reps.filter((r) => r.success)
  const tokens = valid.map((r) => r.tokensIn + r.tokensOut)
  const costs = valid.map((r) => r.totalCostUsd)
  return {
    taskId,
    infraHash,
    n: valid.length,
    medianTokens: median(tokens),
    spreadTokens: spread(tokens),
    medianCostUsd: median(costs),
  }
}

export interface Delta {
  taskId: string
  before: number
  after: number
  absDelta: number
  pctDelta: number
}

export function compare(taskId: string, before: number, after: number): Delta {
  const absDelta = after - before
  return {
    taskId,
    before,
    after,
    absDelta,
    pctDelta: before === 0 ? Number.NaN : (absDelta / before) * 100,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/benchmark/stats.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/benchmark/stats.ts src/main/services/benchmark/stats.test.ts
git commit -m "feat(benchmark): median/spread aggregation and before/after compare

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frozen task fixture

Five concrete read-only tasks against this repo's real modules, each with a validity assertion. These are the curated seed set — hand-tune or swap in transcript-derived prompts later, keeping them read-only and verifiable.

**Files:**
- Create: `src/main/services/benchmark/tasks.ts`

- [ ] **Step 1: Create the fixture**

```typescript
// src/main/services/benchmark/tasks.ts
import type { BenchmarkTask } from '@main/services/benchmark/types'

// Frozen read-only benchmark tasks. Each runs against the atlas-os repo at the
// current commit with read-only tools only. `assert` gates validity (defends the
// cheap-failure trap). Keep tasks read-only and their assertions verifiable.
export const TASKS: BenchmarkTask[] = [
  {
    id: 'explain-kpi',
    prompt:
      'Read src/shared/kpi.ts in this repo. In one paragraph, explain how the expected token count is computed (the baseline model). Mention what inputs the scope regression uses.',
    assert: { type: 'regex', value: 'files|dirs|regression|scope' },
  },
  {
    id: 'find-infra-watcher',
    prompt:
      'Which file in this repo implements the infra-change watcher that writes rows into the ecosystem_changes table? Reply with the file path.',
    assert: { type: 'includes', value: 'infra.ts' },
  },
  {
    id: 'list-trpc-routers',
    prompt: 'List the tRPC sub-routers registered in the application root router (src/main/trpc/router.ts).',
    assert: { type: 'includes', value: 'productivity' },
  },
  {
    id: 'subscription-env',
    prompt:
      'What does the subscriptionEnv helper in src/main/services/claude.ts do, and why? Be specific about which environment variables it removes.',
    assert: { type: 'regex', value: 'ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN' },
  },
  {
    id: 'productivity-tabs',
    prompt:
      'What tabs does the Productivity page (src/renderer/src/pages/Productivity.tsx) render? List them.',
    assert: { type: 'regex', value: 'overview|sessions|ecosystem' },
  },
]
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck:node`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/benchmark/tasks.ts
git commit -m "feat(benchmark): frozen read-only task fixture

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: SDK runner (integration-thin)

Wraps `query()`. **CRITICAL:** unlike `difficulty.ts`/`claude.ts` (which set `settingSources: []`, `allowedTools: []` to *exclude* infra), this sets `settingSources: ['user','project']` to *load* the infra under test. `allowedTools` is restricted to read-only tools, so even with `bypassPermissions` the live repo cannot be mutated; this measures the infra's prompt-prefix + read-only exploration cost (broadening tools to MCP/skill calls is a deliberate later step). No unit test — it is integration (native + `query()`); verified by typecheck/lint and a real run later.

**Files:**
- Create: `src/main/services/benchmark/runner.ts`

- [ ] **Step 1: Create the runner**

```typescript
// src/main/services/benchmark/runner.ts
import { execFileSync } from 'node:child_process'
import { checkRun } from '@main/services/benchmark/gate'
import type { BenchmarkTask, RunResult } from '@main/services/benchmark/types'

const TIMEOUT_MS = 5 * 60_000

// Mirror difficulty.ts: force the user's Pro/Max OAuth by stripping API keys.
function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

export interface RunOptions {
  model: string
  repoRoot: string
  timeoutMs?: number
}

export async function runBenchmarkTask(task: BenchmarkTask, opts: RunOptions): Promise<RunResult> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS)

  let resultText = ''
  let tokensIn = 0
  let tokensOut = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let totalCostUsd = 0
  let numTurns = 0
  let durationMs = 0
  let subtype = 'error'
  let sessionId: string | null = null

  try {
    const q = query({
      prompt: task.prompt,
      options: {
        model: opts.model,
        settingSources: ['user', 'project'], // LOAD infra under test — opposite of difficulty.ts
        allowedTools: ['Read', 'Grep', 'Glob'], // read-only — live repo cannot mutate
        permissionMode: 'bypassPermissions', // headless: never hang on a prompt
        cwd: opts.repoRoot,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    for await (const message of q) {
      if (message.type === 'result') {
        subtype = message.subtype
        numTurns = message.num_turns
        durationMs = message.duration_ms
        sessionId = message.session_id
        if (message.subtype === 'success') {
          resultText = message.result
          totalCostUsd = message.total_cost_usd
          tokensIn = message.usage.input_tokens ?? 0
          tokensOut = message.usage.output_tokens ?? 0
          cacheReadTokens = message.usage.cache_read_input_tokens ?? 0
          cacheCreationTokens = message.usage.cache_creation_input_tokens ?? 0
        }
      }
    }
  } catch {
    // swallow — gate below classifies via the aborted flag / non-success subtype
  } finally {
    clearTimeout(timer)
  }

  const gate = checkRun({ subtype, resultText, aborted: controller.signal.aborted }, task.assert)
  return {
    taskId: task.id,
    model: opts.model,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    cacheCreationTokens,
    totalCostUsd,
    numTurns,
    durationMs,
    success: gate.valid,
    failReason: gate.failReason,
    sessionId,
  }
}

export function repoCommit(repoRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
  } catch {
    return 'unknown'
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck:node && pnpm lint`
Expected: PASS. If biome flags the empty `catch {}`, add a clarifying comment line inside it (already present) — that is intentional, not an error to suppress with a rule disable.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/benchmark/runner.ts
git commit -m "feat(benchmark): claude headless runner that loads infra under test

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Database table + migration

Add the `benchmark_runs` table following the `agentTurns` pattern. `infraSnapshot` is a JSON column typed via an inline `import(...)` type (erased — avoids a runtime cycle between `schema.ts` and `infra.ts`).

**Files:**
- Modify: `src/main/db/schema.ts` (append a new table; `real` and all column helpers are already imported)
- Create (generated): `drizzle/*.sql` + drizzle meta

- [ ] **Step 1: Append the table to `schema.ts`**

Add at the end of `src/main/db/schema.ts`:

```typescript
// One row per benchmark run (task × rep). Frozen-task token cost stamped with an
// infra fingerprint so cost is comparable across infra versions. See
// docs/superpowers/specs/2026-05-25-benchmark-suite-design.md.
export const benchmarkRuns = sqliteTable(
  'benchmark_runs',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
    taskId: text('task_id').notNull(),
    rep: integer('rep').notNull(),
    infraHash: text('infra_hash').notNull(),
    infraSnapshot: text('infra_snapshot', { mode: 'json' })
      .$type<import('@main/services/productivity/infra').InfraState>()
      .notNull(),
    repoCommit: text('repo_commit').notNull(),
    model: text('model').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    totalCostUsd: real('total_cost_usd').notNull().default(0),
    numTurns: integer('num_turns').notNull().default(0),
    durationMs: integer('duration_ms').notNull().default(0),
    success: integer('success', { mode: 'boolean' }).notNull(),
    failReason: text('fail_reason'),
    transcriptPath: text('transcript_path'),
  },
  (t) => [
    index('idx_bench_task').on(t.taskId),
    index('idx_bench_infra').on(t.infraHash),
    index('idx_bench_batch').on(t.batchId),
    index('idx_bench_ts').on(t.ts),
  ],
)
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm db:generate`
Expected: a new file appears under `drizzle/` (e.g. `drizzle/0007_*.sql`) containing `CREATE TABLE \`benchmark_runs\``, plus updated `drizzle/meta/`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck:node`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/db/schema.ts drizzle/
git commit -m "feat(benchmark): benchmark_runs table + migration

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Batch orchestrator (integration)

Starts a background loop (the mutation must not block — 25 runs × minutes), persists one row per run, and tracks progress in an in-memory map. Infra is snapshotted once per batch (it is constant during a batch). No unit test (DB native module).

**Files:**
- Create: `src/main/services/benchmark/batch.ts`

- [ ] **Step 1: Create the orchestrator**

```typescript
// src/main/services/benchmark/batch.ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { db } from '@main/db/client'
import { benchmarkRuns } from '@main/db/schema'
import { appPaths } from '@main/paths'
import { infraFingerprint } from '@main/services/benchmark/fingerprint'
import { repoCommit, runBenchmarkTask } from '@main/services/benchmark/runner'
import { TASKS } from '@main/services/benchmark/tasks'
import type { BenchmarkTask } from '@main/services/benchmark/types'
import { readInfraState } from '@main/services/productivity/infra'
import { app } from 'electron'

const DEFAULT_K = 5
const DEFAULT_MODEL = 'claude-sonnet-4-6'

export interface Progress {
  batchId: string
  total: number
  done: number
  failed: number
  running: boolean
}

const batches = new Map<string, Progress>()

export function getProgress(batchId: string): Progress | null {
  return batches.get(batchId) ?? null
}

export interface StartOptions {
  taskIds?: string[]
  k?: number
  model?: string
}

export function startBatch(opts: StartOptions): { batchId: string; total: number } {
  const k = opts.k ?? DEFAULT_K
  const model = opts.model ?? DEFAULT_MODEL
  const tasks = opts.taskIds ? TASKS.filter((t) => opts.taskIds?.includes(t.id)) : TASKS
  const total = tasks.length * k
  const batchId = randomUUID()
  const progress: Progress = { batchId, total, done: 0, failed: 0, running: true }
  batches.set(batchId, progress)
  void runLoop(batchId, tasks, k, model, progress)
  return { batchId, total }
}

async function runLoop(
  batchId: string,
  tasks: BenchmarkTask[],
  k: number,
  model: string,
  progress: Progress,
): Promise<void> {
  const repoRoot = app.getAppPath()
  const commit = repoCommit(repoRoot)
  const p = appPaths()
  const infra = await readInfraState({
    settingsPath: join(p.claudeDir, 'settings.json'),
    claudeJsonPath: p.claudeJson,
    skillsDir: join(p.claudeDir, 'skills'),
  })
  const infraHash = infraFingerprint(infra)

  for (const task of tasks) {
    for (let rep = 0; rep < k; rep++) {
      const result = await runBenchmarkTask(task, { model, repoRoot })
      db()
        .insert(benchmarkRuns)
        .values({
          id: randomUUID(),
          batchId,
          ts: new Date(),
          taskId: task.id,
          rep,
          infraHash,
          infraSnapshot: infra,
          repoCommit: commit,
          model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          cacheReadTokens: result.cacheReadTokens,
          cacheCreationTokens: result.cacheCreationTokens,
          totalCostUsd: result.totalCostUsd,
          numTurns: result.numTurns,
          durationMs: result.durationMs,
          success: result.success,
          failReason: result.failReason,
          transcriptPath: result.sessionId,
        })
        .run()
      progress.done += 1
      if (!result.success) progress.failed += 1
    }
  }
  progress.running = false
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck:node && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/services/benchmark/batch.ts
git commit -m "feat(benchmark): background batch orchestrator with progress + persistence

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: tRPC router

Exposes `tasks`, `run` (starts a batch, returns immediately), `progress` (polled by the UI), and `results` (grouped task×infra summaries). Then register it in the root router.

**Files:**
- Create: `src/main/trpc/routers/benchmark.ts`
- Modify: `src/main/trpc/router.ts`

- [ ] **Step 1: Create the router**

```typescript
// src/main/trpc/routers/benchmark.ts
import { db } from '@main/db/client'
import { benchmarkRuns } from '@main/db/schema'
import { getProgress, startBatch } from '@main/services/benchmark/batch'
import { summarize, type TaskInfraSummary } from '@main/services/benchmark/stats'
import { TASKS } from '@main/services/benchmark/tasks'
import { publicProcedure, router } from '@main/trpc/trpc'
import { z } from 'zod'

export const benchmarkRouter = router({
  tasks: publicProcedure
    .output(z.array(z.object({ id: z.string(), prompt: z.string() })))
    .query(() => TASKS.map((t) => ({ id: t.id, prompt: t.prompt }))),

  run: publicProcedure
    .input(
      z.object({
        taskIds: z.array(z.string()).optional(),
        k: z.number().int().min(1).max(20).default(5),
        model: z.string().default('claude-sonnet-4-6'),
      }),
    )
    .output(z.object({ batchId: z.string(), total: z.number() }))
    .mutation(({ input }) => startBatch(input)),

  progress: publicProcedure
    .input(z.object({ batchId: z.string() }))
    .output(
      z
        .object({
          batchId: z.string(),
          total: z.number(),
          done: z.number(),
          failed: z.number(),
          running: z.boolean(),
        })
        .nullable(),
    )
    .query(({ input }) => getProgress(input.batchId)),

  results: publicProcedure
    .output(
      z.array(
        z.object({
          taskId: z.string(),
          infraHash: z.string(),
          n: z.number(),
          medianTokens: z.number(),
          spreadTokens: z.number(),
          medianCostUsd: z.number(),
        }),
      ),
    )
    .query(() => {
      const rows = db().select().from(benchmarkRuns).all()
      const groups = new Map<string, typeof rows>()
      for (const r of rows) {
        const key = `${r.taskId}::${r.infraHash}`
        const arr = groups.get(key) ?? []
        arr.push(r)
        groups.set(key, arr)
      }
      const summaries: TaskInfraSummary[] = []
      for (const g of groups.values()) {
        summaries.push(
          summarize(
            g[0].taskId,
            g[0].infraHash,
            g.map((r) => ({
              tokensIn: r.tokensIn,
              tokensOut: r.tokensOut,
              totalCostUsd: r.totalCostUsd,
              success: r.success,
            })),
          ),
        )
      }
      return summaries
    }),
})
```

- [ ] **Step 2: Register in the root router**

Modify `src/main/trpc/router.ts`. Add the import (alphabetical, with the other router imports):

```typescript
import { benchmarkRouter } from '@main/trpc/routers/benchmark'
```

Add the entry to the `router({ ... })` object:

```typescript
  benchmark: benchmarkRouter,
```

So `appRouter` becomes:

```typescript
export const appRouter = router({
  health: healthRouter,
  settings: settingsRouter,
  agent: agentRouter,
  stats: statsRouter,
  skills: skillsRouter,
  productivity: productivityRouter,
  benchmark: benchmarkRouter,
})
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck:node && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/benchmark.ts src/main/trpc/router.ts
git commit -m "feat(benchmark): tRPC router (run/progress/results/tasks)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Benchmark tab UI

Add a 4th tab to `Productivity.tsx`, matching the existing inline-component pattern (`OverviewTab`/`SessionsTab`/`EcosystemTab` are functions in this same file). The run button shows the estimated run count and requires confirmation (cost gate). Progress polls every 2s while a batch runs; results refresh when it finishes.

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx`

- [ ] **Step 1: Extend the `Tab` type and `TABS` array**

Find (near the top of the file):

```typescript
type Tab = 'overview' | 'sessions' | 'ecosystem'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'overview', label: './overview' },
  { id: 'sessions', label: './sessions' },
  { id: 'ecosystem', label: './ecosystem' },
]
```

Replace with:

```typescript
type Tab = 'overview' | 'sessions' | 'ecosystem' | 'benchmark'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'overview', label: './overview' },
  { id: 'sessions', label: './sessions' },
  { id: 'ecosystem', label: './ecosystem' },
  { id: 'benchmark', label: './benchmark' },
]
```

- [ ] **Step 2: Render the tab**

Find the conditional renders:

```typescript
{tab === 'ecosystem' ? <EcosystemTab days={days} /> : null}
```

Add immediately after it:

```typescript
{tab === 'benchmark' ? <BenchmarkTab /> : null}
```

- [ ] **Step 3: Add the `BenchmarkTab` component**

Add this function near the other tab components (e.g. after `function EcosystemTab(...) { ... }`). `trpc`, `toast`, `useState`, and `useEffect` are already imported at the top of the file.

```typescript
function BenchmarkTab() {
  const utils = trpc.useUtils()
  const tasks = trpc.benchmark.tasks.useQuery()
  const results = trpc.benchmark.results.useQuery()
  const [batchId, setBatchId] = useState<string | null>(null)
  const [k, setK] = useState(5)
  const [model, setModel] = useState('claude-sonnet-4-6')

  const progress = trpc.benchmark.progress.useQuery(
    { batchId: batchId ?? '' },
    { enabled: batchId != null, refetchInterval: 2000 },
  )

  const run = trpc.benchmark.run.useMutation({
    onSuccess: (r) => {
      setBatchId(r.batchId)
      toast.success(`Benchmark started: ${r.total} runs`)
    },
  })

  useEffect(() => {
    if (progress.data && !progress.data.running) void utils.benchmark.results.invalidate()
  }, [progress.data, utils])

  const taskCount = tasks.data?.length ?? 0
  const estimated = taskCount * k
  const running = progress.data?.running ?? false

  return (
    <div className="benchmark">
      <div className="bench-controls">
        <label>
          model{' '}
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
        <label>
          reps (k){' '}
          <input
            type="number"
            min={1}
            max={20}
            value={k}
            onChange={(e) => setK(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          disabled={running || run.isPending}
          onClick={() => {
            if (
              window.confirm(
                `Run ${estimated} real claude runs (${taskCount} tasks × ${k})? This spends tokens.`,
              )
            ) {
              run.mutate({ k, model })
            }
          }}
        >
          {running ? 'running…' : `run benchmark (${estimated})`}
        </button>
        {progress.data ? (
          <span className="bench-progress">
            {progress.data.done}/{progress.data.total} done · {progress.data.failed} failed
          </span>
        ) : null}
      </div>

      <table className="bench-results">
        <thead>
          <tr>
            <th>task</th>
            <th>infra</th>
            <th>n</th>
            <th>median tokens</th>
            <th>spread</th>
            <th>median cost</th>
          </tr>
        </thead>
        <tbody>
          {(results.data ?? []).map((r) => (
            <tr key={`${r.taskId}-${r.infraHash}`}>
              <td>{r.taskId}</td>
              <td>{r.infraHash}</td>
              <td>{r.n}</td>
              <td>{Math.round(r.medianTokens)}</td>
              <td>{Math.round(r.spreadTokens)}</td>
              <td>${r.medianCostUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

> Note: if `trpc.useUtils` is not the idiom in this file, use the same accessor the existing tabs use for `utils` (search the file for `const utils =` — it may be `trpc.useContext()`). Keep the rest identical.

- [ ] **Step 4: Typecheck (web) + lint**

Run: `pnpm typecheck:web && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(benchmark): Benchmark tab — run control, progress, results table

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Full verification + merge

**Files:** none (verification + integration only)

- [ ] **Step 1: Run the full gate**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all PASS (15 new benchmark unit tests green; existing suite still green; typecheck node+web clean; biome clean).

- [ ] **Step 2: Smoke-test a real run (small, cost-gated)**

Launch the app, open Productivity → `./benchmark`, set `k=1`, click run, confirm the dialog. Expected: progress climbs to `5/5 done` (5 tasks × 1), the results table shows 5 rows with non-zero median tokens and an infra hash, and `failed` is 0 (or low). This is the only real-token step — keep `k=1` for the smoke test.

> If any task shows `failed`, inspect its `failReason` in the `benchmark_runs` table (or loosen that task's assertion in `tasks.ts`). `assertion_failed` means the model answered but missed the assertion; `sdk_error`/`timeout` means the run itself failed.

- [ ] **Step 3: Merge into main (LOCAL ONLY — DO NOT PUSH)**

```bash
git checkout main
git merge --no-ff feat/benchmark-suite -m "Merge branch 'feat/benchmark-suite'

Benchmark suite: frozen read-only tasks run on real claude headless under the
current infra, token cost stamped with an infra fingerprint, compared across
infra versions. Manual trigger for v1.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Do NOT `git push` — the user pushes himself ([[no-push-user-pushes]]).

---

## Self-review notes (for the implementer)

- **Spec coverage:** task type (read-only, Task 5/6), curated set (Task 5), pinned atlas-os sandbox + `repoCommit` (Task 6/8), k=5 configurable (Task 8/9/10), success gate subtype+assertion (Task 2/6), manual trigger (Task 9/10), model configurable default Sonnet (Task 8/9/10), cache tokens recorded separately (Task 6/7/8) — all present.
- **Out of scope (do not build):** mutating tasks + fixture reset, auto-trigger on infra change, transcript-miner automation. The `taskIds` param and the per-batch infra snapshot leave clean hooks for these later.
- **Known thin spots resolved here:** `subscriptionEnv` is private in `claude.ts`, so the runner re-defines it locally (matching the `difficulty.ts` precedent) rather than exporting it. `schema.ts`↔`infra.ts` cycle avoided via inline `import(...)` type. `trpc.useUtils` flagged with a fallback note in Task 10.
