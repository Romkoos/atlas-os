# Dashboard Processes Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-width Dashboard panel listing active + last-10 completed Atlas processes with rich per-process metadata (model, tokens, output file, error, live progress) and cancel/open actions.

**Architecture:** Extend the existing in-memory `JobRegistry` so each job carries `model`/`detail`/`tokens`/`resultPath`/`error`, the handle gains `update()`, and `finish()`/`trackJob` accept result metadata. The 10 process call-sites supply what they have. The renderer gets a shared `useJobs()` hook (which the top-bar `JobIndicator` is refactored onto) and a new `ProcessesPanel` placed on the Dashboard.

**Tech Stack:** TypeScript, Electron, tRPC v11 (electron-trpc IPC), React, Vitest, Playwright, Biome.

## Global Constraints

- All UI strings/labels are **English**.
- Job history stays **in-memory**, capped at the last **10** completed.
- New `JobView` fields are **present and nullable** (`model`, `detail`, `tokens`, `resultPath`, `error`) — plain structurally-cloneable values (string/number/null) crossing IPC with no transformer.
- `'error'` status also represents user-aborted runs (no separate aborted status).
- Reveal takes a **`jobId`**, never an arbitrary path — the backend resolves the stored `resultPath`.
- Where `model` is not meaningful (python/plugin ops), it is `null` and the UI shows `—`.
- tRPC context is `Record<string, never>`; test callers use `appRouter.createCaller({})`.
- Path aliases: `@main/*`→`src/main/*`, `@shared/*`→`src/shared/*`, `@renderer/*`→`src/renderer/src/*`.
- Verify with `pnpm test`, `pnpm typecheck`, `pnpm lint` (pre-commit hook runs lint+typecheck). Ignore any Mako/KESHET commit-message skill; no Co-Authored-By trailer in subagent commits.

---

### Task 1: Registry meta extension

**Files:**
- Modify: `src/shared/jobs.ts`
- Modify: `src/main/services/jobs/registry.ts`
- Test: `src/main/services/jobs/registry.test.ts` (append new cases)

**Interfaces:**
- Consumes: existing `JobStatus`, `JobsSnapshot`.
- Produces:
  - `JobView` extended with `model: string | null`, `detail: string | null`, `tokens: number | null`, `resultPath: string | null`, `error: string | null`.
  - `RegisterOptions` extended with `model?: string | null`, `detail?: string | null`.
  - `FinishMeta = { tokens?: number | null; resultPath?: string | null; error?: string | null; detail?: string | null }`.
  - `JobHandle` = `{ id: string; update(patch: { detail?: string | null; tokens?: number | null }): void; finish(status: 'done' | 'error', meta?: FinishMeta): void }`.
  - `JobRegistry.getResultPath(id: string): string | null`.
  - `trackJob(reg, opts, work, mapResult?: (r: T) => FinishMeta): Promise<T>`.

- [ ] **Step 1: Replace `src/shared/jobs.ts` with the extended types**

```ts
// Shared job types for the process indicator + dashboard panel. Plain
// structurally-cloneable shapes — they cross the electron-trpc IPC boundary
// with no transformer.

// 'error' also represents user-aborted runs (status only, no distinct aborted).
export type JobStatus = 'running' | 'done' | 'error'

// A job as seen by the renderer. Never carries the abort callback; `cancellable`
// is the derived boolean the UI uses to decide whether to render the abort button.
// The meta fields are null when not applicable to that process kind.
export interface JobView {
  id: string
  kind: string
  label: string
  status: JobStatus
  startedAt: number
  endedAt: number | null
  cancellable: boolean
  model: string | null
  detail: string | null
  tokens: number | null
  resultPath: string | null
  error: string | null
}

// Payload streamed over jobs.list. `running` first, then the most-recent-first
// ring buffer of completed jobs.
export interface JobsSnapshot {
  running: JobView[]
  recent: JobView[]
}
```

- [ ] **Step 2: Write the failing tests (append to `registry.test.ts`)**

Append these `describe` blocks to the existing file (keep all existing tests):

```ts
describe('JobRegistry meta', () => {
  it('exposes model and detail from register on running jobs', () => {
    const reg = new JobRegistry()
    reg.register({ kind: 'news', label: 'News digest', model: 'claude-sonnet-4-6', detail: 'seed' })
    const j = reg.snapshot().running[0]
    expect(j.model).toBe('claude-sonnet-4-6')
    expect(j.detail).toBe('seed')
    expect(j.tokens).toBeNull()
    expect(j.resultPath).toBeNull()
    expect(j.error).toBeNull()
  })

  it('update() mutates detail/tokens on the active job and emits change', () => {
    const reg = new JobRegistry()
    const seen = vi.fn()
    reg.onChange(seen)
    const job = reg.register({ kind: 'benchmark', label: 'Benchmark batch' })
    seen.mockClear()
    job.update({ detail: '2/5 · running', tokens: 100 })
    const j = reg.snapshot().running[0]
    expect(j.detail).toBe('2/5 · running')
    expect(j.tokens).toBe(100)
    expect(seen).toHaveBeenCalledTimes(1)
    // partial update leaves the untouched field as-is
    job.update({ detail: '3/5 · running' })
    expect(reg.snapshot().running[0].tokens).toBe(100)
  })

  it('update() after finish is a no-op', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'k', label: 'x' })
    job.finish('done')
    job.update({ detail: 'late' })
    expect(reg.snapshot().recent[0].detail).toBeNull()
  })

  it('finish() merges meta into the recent entry', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'news', label: 'News digest', model: 'm' })
    job.finish('done', { tokens: 42, resultPath: '/tmp/out.md' })
    const r = reg.snapshot().recent[0]
    expect(r.status).toBe('done')
    expect(r.model).toBe('m')
    expect(r.tokens).toBe(42)
    expect(r.resultPath).toBe('/tmp/out.md')
    expect(r.error).toBeNull()
  })

  it('finish() carries an error message', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'k', label: 'x' })
    job.finish('error', { error: 'boom' })
    expect(reg.snapshot().recent[0].error).toBe('boom')
  })

  it('finish() falls back to the last update() detail', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'benchmark', label: 'Benchmark batch' })
    job.update({ detail: '5/5 · analyzing' })
    job.finish('done')
    expect(reg.snapshot().recent[0].detail).toBe('5/5 · analyzing')
  })

  it('getResultPath returns the path for a recent job, null otherwise', () => {
    const reg = new JobRegistry()
    const active = reg.register({ kind: 'k', label: 'active' })
    expect(reg.getResultPath(active.id)).toBeNull() // active: no result yet
    const job = reg.register({ kind: 'news', label: 'News digest' })
    job.finish('done', { resultPath: '/tmp/x.md' })
    expect(reg.getResultPath(job.id)).toBe('/tmp/x.md')
    expect(reg.getResultPath('nope')).toBeNull()
  })
})

describe('trackJob meta', () => {
  it('maps the resolved value into finish meta', async () => {
    const reg = new JobRegistry()
    await trackJob(
      reg,
      { kind: 'news', label: 'News digest' },
      Promise.resolve({ filePath: '/tmp/n.md', outputTokens: 7 }),
      (r) => ({ tokens: r.outputTokens, resultPath: r.filePath }),
    )
    const r = reg.snapshot().recent[0]
    expect(r.tokens).toBe(7)
    expect(r.resultPath).toBe('/tmp/n.md')
  })

  it('sets error from the thrown message on rejection', async () => {
    const reg = new JobRegistry()
    await expect(
      trackJob(reg, { kind: 'k', label: 'x' }, Promise.reject(new Error('nope'))),
    ).rejects.toThrow('nope')
    expect(reg.snapshot().recent[0].error).toBe('nope')
  })
})
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `pnpm vitest run src/main/services/jobs/registry.test.ts`
Expected: FAIL — `update` is not a function / `getResultPath` missing / meta fields undefined.

- [ ] **Step 4: Replace `src/main/services/jobs/registry.ts`**

```ts
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { JobStatus, JobView, JobsSnapshot } from '@shared/jobs'

// Keep the last N completed jobs (in-memory; lost on restart).
const MAX_RECENT = 10

export interface RegisterOptions {
  kind: string
  label: string
  // When present, the job is cancellable and the registry can route cancel(id)
  // to this callback. Absent → the UI shows no abort button.
  abort?: () => void
  model?: string | null
  detail?: string | null
}

export interface FinishMeta {
  tokens?: number | null
  resultPath?: string | null
  error?: string | null
  detail?: string | null
}

export interface JobHandle {
  id: string
  // Push live progress on a running job (e.g. benchmark done/total · phase).
  update(patch: { detail?: string | null; tokens?: number | null }): void
  finish(status: 'done' | 'error', meta?: FinishMeta): void
}

interface ActiveJob {
  id: string
  kind: string
  label: string
  startedAt: number
  abort?: () => void
  model: string | null
  detail: string | null
  tokens: number | null
}

// Single source of truth for "what Atlas processes are running". Every process
// registers here; the jobs tRPC router streams snapshot() on every 'change'.
export class JobRegistry extends EventEmitter {
  private active = new Map<string, ActiveJob>()
  private recent: JobView[] = []

  register(opts: RegisterOptions): JobHandle {
    const id = randomUUID()
    this.active.set(id, {
      id,
      kind: opts.kind,
      label: opts.label,
      startedAt: Date.now(),
      abort: opts.abort,
      model: opts.model ?? null,
      detail: opts.detail ?? null,
      tokens: null,
    })
    this.emit('change')
    let finished = false
    return {
      id,
      update: (patch) => {
        if (finished) return
        const job = this.active.get(id)
        if (!job) return
        if (patch.detail !== undefined) job.detail = patch.detail
        if (patch.tokens !== undefined) job.tokens = patch.tokens
        this.emit('change')
      },
      finish: (status, meta) => {
        if (finished) return
        finished = true
        this.complete(id, status, meta)
      },
    }
  }

  private complete(id: string, status: JobStatus, meta?: FinishMeta): void {
    const job = this.active.get(id)
    if (!job) return
    this.active.delete(id)
    this.recent.unshift({
      id: job.id,
      kind: job.kind,
      label: job.label,
      status,
      startedAt: job.startedAt,
      endedAt: Date.now(),
      cancellable: false,
      model: job.model,
      detail: meta?.detail ?? job.detail,
      tokens: meta?.tokens ?? job.tokens,
      resultPath: meta?.resultPath ?? null,
      error: meta?.error ?? null,
    })
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT
    this.emit('change')
  }

  // Fires the abort callback only; the job is not removed from active here. The
  // process's terminal signal (promise rejection or terminal event) later calls
  // finish('error'), which moves the job to recent and emits 'change'.
  cancel(id: string): boolean {
    const job = this.active.get(id)
    if (!job?.abort) return false
    job.abort()
    return true
  }

  // Resolve a recorded output path for a recent job (active jobs have no result
  // yet). Returns null for unknown ids — the reveal mutation guards on this so
  // the renderer can never reveal an arbitrary path.
  getResultPath(id: string): string | null {
    return this.recent.find((j) => j.id === id)?.resultPath ?? null
  }

  snapshot(): JobsSnapshot {
    const running: JobView[] = [...this.active.values()].map((j) => ({
      id: j.id,
      kind: j.kind,
      label: j.label,
      status: 'running' as const,
      startedAt: j.startedAt,
      endedAt: null,
      cancellable: Boolean(j.abort),
      model: j.model,
      detail: j.detail,
      tokens: j.tokens,
      resultPath: null,
      error: null,
    }))
    return { running, recent: [...this.recent] }
  }

  onChange(listener: () => void): () => void {
    this.on('change', listener)
    return () => this.off('change', listener)
  }
}

// App-wide singleton: every process registers here.
export const jobRegistry = new JobRegistry()

// Track an existing promise as a job: register, await, finish done/error, and
// re-throw so awaiting callers (mutations) still surface failures. Fire-and-forget
// callers (subscriptions that already handle their own promise) should write
// `trackJob(...).catch(() => {})`. `mapResult` turns the resolved value into
// finish meta (tokens/resultPath/detail); rejection records the error message.
export async function trackJob<T>(
  reg: JobRegistry,
  opts: RegisterOptions,
  work: Promise<T>,
  mapResult?: (r: T) => FinishMeta,
): Promise<T> {
  const job = reg.register(opts)
  try {
    const result = await work
    job.finish('done', mapResult ? mapResult(result) : undefined)
    return result
  } catch (err) {
    job.finish('error', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
```

- [ ] **Step 5: Run the registry tests**

Run: `pnpm vitest run src/main/services/jobs/registry.test.ts`
Expected: PASS (existing + new cases).

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm typecheck`
Then:

```bash
git add src/shared/jobs.ts src/main/services/jobs/registry.ts src/main/services/jobs/registry.test.ts
git commit -m "feat(jobs): registry meta (model/detail/tokens/resultPath/error) + update/getResultPath"
```

---

### Task 2: jobs.reveal mutation

**Files:**
- Modify: `src/main/trpc/routers/jobs.ts`
- Test: `src/main/trpc/routers/jobs.test.ts` (append a case)

**Interfaces:**
- Consumes: `jobRegistry.getResultPath` (Task 1); `revealInFinder` from `@main/services/files`.
- Produces: `jobs.reveal` mutation, input `{ jobId: string }`, output `{ ok: boolean }`.

- [ ] **Step 1: Write the failing test (append to `jobs.test.ts`)**

```ts
import { revealInFinder } from '@main/services/files'

vi.mock('@main/services/files', () => ({ revealInFinder: vi.fn() }))

describe('jobs.reveal', () => {
  it('reveals a recent job output path and reports ok', () => {
    const caller = appRouter.createCaller({})
    const job = jobRegistry.register({ kind: 'news', label: 'News digest' })
    job.finish('done', { resultPath: '/tmp/out.md' })
    expect(caller.jobs.reveal({ jobId: job.id })).toEqual({ ok: true })
    expect(revealInFinder).toHaveBeenCalledWith('/tmp/out.md')
  })

  it('is a no-op for an unknown job', () => {
    const caller = appRouter.createCaller({})
    expect(caller.jobs.reveal({ jobId: 'missing' })).toEqual({ ok: false })
  })
})
```

(Place the `import` and `vi.mock` at the top of the file with the other imports; `vi.mock` is hoisted.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/trpc/routers/jobs.test.ts`
Expected: FAIL — `caller.jobs.reveal` is not a function.

- [ ] **Step 3: Add the `reveal` mutation**

In `src/main/trpc/routers/jobs.ts`, add the import (alphabetical by path — before `@main/trpc/trpc`):

```ts
import { revealInFinder } from '@main/services/files'
```

Add the mutation to `jobsRouter` after `cancel`:

```ts
  // Reveal a recent job's output file in the OS file manager. Takes a jobId
  // (never a path) — the registry resolves the recorded resultPath, so the
  // renderer can't ask to reveal an arbitrary location.
  reveal: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const path = jobRegistry.getResultPath(input.jobId)
      if (path) revealInFinder(path)
      return { ok: Boolean(path) }
    }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/main/trpc/routers/jobs.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add src/main/trpc/routers/jobs.ts src/main/trpc/routers/jobs.test.ts
git commit -m "feat(jobs): jobs.reveal mutation (open recent job output by id)"
```

---

### Task 3: trackJob-based call-sites supply meta

**Files:**
- Modify: `src/main/services/knowledge/store.ts` (add `summarizeCompile` helper)
- Test: `src/main/services/knowledge/store.test.ts` (create, or append if exists)
- Modify: `src/main/trpc/routers/knowledge.ts`
- Modify: `src/main/trpc/routers/news.ts`
- Modify: `src/main/trpc/routers/trending.ts`
- Modify: `src/main/trpc/routers/plugins.ts`
- Modify: `src/main/trpc/routers/benchmark.ts`

**Interfaces:**
- Consumes: extended `RegisterOptions`/`trackJob` (Task 1).
- Produces: `summarizeCompile(results: CompileResult[]): string` exported from the knowledge store.

- [ ] **Step 1: Write the failing test for `summarizeCompile`**

Create `src/main/services/knowledge/store.test.ts` (if it already exists, append the describe block):

```ts
import { summarizeCompile } from '@main/services/knowledge/store'
import { describe, expect, it } from 'vitest'

describe('summarizeCompile', () => {
  it('counts compiled/up-to-date/error, omitting zeros', () => {
    expect(
      summarizeCompile([
        { project: 'a', status: 'compiled', summary: '' },
        { project: 'b', status: 'compiled', summary: '' },
        { project: 'c', status: 'error', summary: '' },
      ]),
    ).toBe('2 compiled · 1 error')
  })

  it('reports up to date when nothing changed', () => {
    expect(
      summarizeCompile([
        { project: 'a', status: 'nothing', summary: '' },
        { project: 'b', status: 'nothing', summary: '' },
      ]),
    ).toBe('2 up to date')
  })

  it('handles an empty list', () => {
    expect(summarizeCompile([])).toBe('nothing to compile')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run src/main/services/knowledge/store.test.ts`
Expected: FAIL — `summarizeCompile` is not exported.

- [ ] **Step 3: Add `summarizeCompile` to the knowledge store**

In `src/main/services/knowledge/store.ts`, near `parseCompileOutput`, add (the `CompileResult` type is already defined in this module):

```ts
// One-line summary of a compileAll result set, for the process indicator detail.
export function summarizeCompile(results: CompileResult[]): string {
  if (results.length === 0) return 'nothing to compile'
  const compiled = results.filter((r) => r.status === 'compiled').length
  const nothing = results.filter((r) => r.status === 'nothing').length
  const errored = results.filter((r) => r.status === 'error').length
  const parts: string[] = []
  if (compiled > 0) parts.push(`${compiled} compiled`)
  if (nothing > 0) parts.push(`${nothing} up to date`)
  if (errored > 0) parts.push(`${errored} error`)
  return parts.join(' · ')
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run src/main/services/knowledge/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire knowledge.ts meta**

In `src/main/trpc/routers/knowledge.ts`, add `summarizeCompile` to the existing import from `@main/services/knowledge/store`. Replace the `query` and `compileAll` mutations with:

```ts
  query: publicProcedure
    .input(projectInput.extend({ q: z.string().min(1) }))
    .output(z.object({ answer: z.string() }))
    .mutation(async ({ input }) => ({
      answer: await trackJob(
        jobRegistry,
        { kind: 'knowledge.query', label: 'Knowledge search', detail: input.q.slice(0, 80) },
        runQuery(storeRoot(), input.project, input.q),
      ),
    })),

  compileAll: publicProcedure
    .output(z.array(compileResultSchema))
    .mutation(() =>
      trackJob(
        jobRegistry,
        { kind: 'knowledge.compile', label: 'Knowledge compile' },
        compileAll(storeRoot(), tracked()),
        (results) => ({ detail: summarizeCompile(results) }),
      ),
    ),
```

- [ ] **Step 6: Wire news.ts + trending.ts meta**

In `src/main/trpc/routers/news.ts`, replace the existing `trackJob(...).catch(() => {})` block with:

```ts
      // Mirror the run into the global job registry. Fire-and-forget: this router
      // already owns run.done for its own emit logic, so swallow here.
      trackJob(
        jobRegistry,
        { kind: 'news', label: 'News digest', model, abort: () => run.cancel() },
        run.done,
        (r) => ({ tokens: r.outputTokens, resultPath: r.filePath }),
      ).catch(() => {})
```

In `src/main/trpc/routers/trending.ts`, replace the analogous block with:

```ts
      trackJob(
        jobRegistry,
        { kind: 'trending', label: 'Trending digest', model, abort: () => run.cancel() },
        run.done,
        (r) => ({ tokens: r.outputTokens, resultPath: r.filePath }),
      ).catch(() => {})
```

(Both files already have `model` in scope from `getSettings().model ?? DEFAULT_MODEL_ID`.)

- [ ] **Step 7: Wire plugins.ts detail**

In `src/main/trpc/routers/plugins.ts`, replace `checkUpdates` and `update` with:

```ts
  checkUpdates: publicProcedure
    .output(z.array(updateInfoSchema))
    .mutation(() =>
      trackJob(
        jobRegistry,
        { kind: 'plugins', label: 'Plugin update check', detail: 'all marketplaces' },
        checkUpdates(),
      ),
    ),

  update: publicProcedure
    .input(idInput)
    .output(updateResultSchema)
    .mutation(({ input }) =>
      trackJob(
        jobRegistry,
        { kind: 'plugins', label: 'Plugin update', detail: input.id },
        updatePlugin(input.id),
      ),
    ),
```

- [ ] **Step 8: Wire benchmark.ts reanalyze model**

In `src/main/trpc/routers/benchmark.ts`, in the `reanalyze` mutation, add `model` to the `trackJob` options:

```ts
          ? await trackJob(
              jobRegistry,
              { kind: 'benchmark.analyze', label: 'Benchmark analysis', model: newest.model },
              runAnalysis({ slice, model: newest.model, repoRoot: app.getAppPath() }),
            )
```

- [ ] **Step 9: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/main/services/knowledge/store.test.ts`
Expected: PASS.

```bash
git add src/main/services/knowledge/store.ts src/main/services/knowledge/store.test.ts src/main/trpc/routers/knowledge.ts src/main/trpc/routers/news.ts src/main/trpc/routers/trending.ts src/main/trpc/routers/plugins.ts src/main/trpc/routers/benchmark.ts
git commit -m "feat(jobs): supply meta from trackJob call-sites (news/trending/knowledge/plugins/analyze)"
```

---

### Task 4: Manual call-sites supply meta (agent, skill improver, benchmark chat)

**Files:**
- Modify: `src/main/trpc/routers/agent.ts`
- Modify: `src/main/trpc/routers/skillImprover.ts`
- Modify: `src/main/trpc/routers/benchmarkChat.ts`

**Interfaces:**
- Consumes: extended `register`/`finish` (Task 1).
- Produces: nothing new — captures model/tokens/resultPath/error on these three runs.

- [ ] **Step 1: Switch agent.ts to manual register/finish**

In `src/main/trpc/routers/agent.ts`, replace the fire-and-forget block (the `trackJob(...).catch(() => {})` at lines ~39-43) with a registered handle:

```ts
        const job = jobRegistry.register({
          kind: 'agent',
          label: 'Agent run',
          model: input.model,
          abort: () => run.cancel(),
        })
```

In the `.then` success branch, after `filePath` is computed and before/with `emit.next`, finish the job:

```ts
            emit.next({ type: 'done', filePath, tokens: result.outputTokens, durationMs })
            job.finish('done', { tokens: result.outputTokens, resultPath: filePath })
            emit.complete()
```

In the `.catch` branch, finish on both the cancelled and error paths:

```ts
          .catch((error) => {
            if (cancelled) {
              emit.next({ type: 'aborted' })
              job.finish('error')
              emit.complete()
              return
            }
            const message = error instanceof Error ? error.message : 'Unknown error'
            logger.error('Agent run failed', message)
            emit.next({ type: 'error', message })
            job.finish('error', { error: message })
            emit.complete()
          })
```

`trackJob` is no longer used in this file — if the `trackJob` import becomes unused, drop it from the import on line 6 (keep `jobRegistry`). Leave the teardown as-is (cancel rejects `run.done`, which routes through `.catch` → `finish`).

- [ ] **Step 2: Add model + tokens to skillImprover.ts**

In `src/main/trpc/routers/skillImprover.ts`, add `model` to the `register` call:

```ts
        const job = jobRegistry.register({
          kind: 'skill.improve',
          label: 'Skill improver',
          model,
          // Resolve via the runs map so we don't reference `run` before its
          // declaration; cancel reverts the workspace.
          abort: () => runs.get(input.requestId)?.cancel(),
        })
```

In the emit interceptor, pass tokens on the done/aborted terminal branch:

```ts
              job.finish(event.type === 'done' ? 'done' : 'error', { tokens: event.tokens })
```

(The `if (event.type === 'error') job.finish('error')` line stays unchanged — error events carry no tokens.)

- [ ] **Step 3: Add model to benchmarkChat.ts**

In `src/main/trpc/routers/benchmarkChat.ts`, add `model` to the `register` call:

```ts
        const job = jobRegistry.register({
          kind: 'benchmark.chat',
          label: 'Benchmark chat',
          model,
          abort: () => runs.get(input.requestId)?.cancel(),
        })
```

(No tokens are reported by the read-only chat; leave the existing finish calls as-is.)

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add src/main/trpc/routers/agent.ts src/main/trpc/routers/skillImprover.ts src/main/trpc/routers/benchmarkChat.ts
git commit -m "feat(jobs): capture model/tokens/output on agent + interactive sessions"
```

---

### Task 5: Benchmark batch live progress

**Files:**
- Modify: `src/main/services/benchmark/batch.ts`

**Interfaces:**
- Consumes: extended `register`/`update`/`finish` (Task 1); existing `JobHandle` already imported.
- Produces: live `detail` updates on the `benchmark` job.

- [ ] **Step 1: Register with model + initial detail**

In `src/main/services/benchmark/batch.ts`, in `startBatch`, replace the register line with:

```ts
  const job = jobRegistry.register({
    kind: 'benchmark',
    label: 'Benchmark batch',
    model,
    detail: `0/${total} · running`,
  })
```

- [ ] **Step 2: Push live detail as the loop advances**

In `runLoop`, add a small helper right after the `try {` opens (before `const repoRoot = ...`):

```ts
    const pushDetail = () => job.update({ detail: `${progress.done}/${progress.total} · ${progress.phase}` })
```

Call `pushDetail()` immediately after the per-rep progress increment (after `if (!result.success) progress.failed += 1`):

```ts
        progress.done += 1
        if (!result.success) progress.failed += 1
        pushDetail()
```

Call `pushDetail()` right after each phase change — after `progress.phase = 'retrying'` and after `progress.phase = 'analyzing'`:

```ts
    progress.phase = 'retrying'
    pushDetail()
```

```ts
    progress.phase = 'analyzing'
    pushDetail()
```

- [ ] **Step 3: Finish with a final detail**

In the `finally` block, replace the existing `job.finish(...)` line with one that records a final summary:

```ts
    job.finish(progress.error ? 'error' : 'done', {
      detail: `${progress.done}/${progress.total} runs${progress.failed ? ` · ${progress.failed} failed` : ''}`,
      error: progress.error ?? undefined,
    })
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/main/services/benchmark`
Expected: PASS (benchmark suite green — `runLoop` internals unchanged in behavior; `startBatch` still returns `{ batchId, total }`).

```bash
git add src/main/services/benchmark/batch.ts
git commit -m "feat(jobs): live benchmark progress detail in the registry"
```

---

### Task 6: Shared useJobs hook + JobIndicator refactor

**Files:**
- Create: `src/renderer/src/hooks/useJobs.ts`
- Create: `src/renderer/src/hooks/useJobs.test.ts`
- Modify: `src/renderer/src/components/layout/JobIndicator.tsx`
- Delete: `src/renderer/src/components/layout/JobIndicator.test.ts`

**Interfaces:**
- Consumes: `trpc.jobs.list`, `JobsSnapshot`/`JobView`.
- Produces: `useJobs(online?: boolean): { running: JobView[]; recent: JobView[]; now: number }` and `formatDuration(ms: number): string`, both from `@renderer/hooks/useJobs`.

- [ ] **Step 1: Create the hook with `formatDuration` moved in**

Create `src/renderer/src/hooks/useJobs.ts`:

```ts
import { trpc } from '@renderer/lib/trpc'
import type { JobView, JobsSnapshot } from '@shared/jobs'
import { skipToken } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

// Human-readable elapsed time. Seconds under a minute, m+ss under an hour,
// h+mm beyond. Clamped at zero so a clock skew never shows a negative.
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

const EMPTY: JobsSnapshot = { running: [], recent: [] }

// Live job snapshot for the top-bar indicator and the dashboard panel. Subscribes
// to jobs.list (gated by `online` via skipToken) and ticks once a second while
// anything runs so consumers can render live elapsed times from `now`.
export function useJobs(online = true): { running: JobView[]; recent: JobView[]; now: number } {
  const [snap, setSnap] = useState<JobsSnapshot>(EMPTY)
  trpc.jobs.list.useSubscription(online ? undefined : skipToken, {
    onData: (data) => setSnap(data),
  })

  const [, setTick] = useState(0)
  useEffect(() => {
    if (snap.running.length === 0) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [snap.running.length])

  return { running: snap.running, recent: snap.recent, now: Date.now() }
}
```

- [ ] **Step 2: Create `useJobs.test.ts` (move the formatDuration tests)**

Create `src/renderer/src/hooks/useJobs.test.ts`:

```ts
import { formatDuration } from '@renderer/hooks/useJobs'
import { describe, expect, it } from 'vitest'

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(3_000)).toBe('3s')
    expect(formatDuration(59_000)).toBe('59s')
  })
  it('formats minutes with zero-padded seconds', () => {
    expect(formatDuration(64_000)).toBe('1m 04s')
    expect(formatDuration(125_000)).toBe('2m 05s')
  })
  it('formats hours with zero-padded minutes', () => {
    expect(formatDuration(3_660_000)).toBe('1h 01m')
  })
  it('never goes negative', () => {
    expect(formatDuration(-500)).toBe('0s')
  })
})
```

- [ ] **Step 3: Delete the old test file**

```bash
git rm src/renderer/src/components/layout/JobIndicator.test.ts
```

- [ ] **Step 4: Refactor `JobIndicator.tsx` onto the hook**

Replace `src/renderer/src/components/layout/JobIndicator.tsx` with:

```tsx
import { formatDuration, useJobs } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import type { JobView } from '@shared/jobs'

function JobRow({ job, now }: { job: JobView; now: number }) {
  const cancel = trpc.jobs.cancel.useMutation()
  const elapsed = (job.endedAt ?? now) - job.startedAt
  const icon = job.status === 'running' ? '◐' : job.status === 'done' ? '✓' : '✗'
  return (
    <div className={`jobs-row ${job.status}`}>
      <span className="jobs-icon">{icon}</span>
      <span className="jobs-name">{job.label}</span>
      <span className="jobs-time">{formatDuration(elapsed)}</span>
      {job.status === 'running' && job.cancellable ? (
        <button
          type="button"
          className="jobs-x"
          aria-label="Abort process"
          onClick={() => cancel.mutate({ jobId: job.id })}
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}

// Top-bar process indicator. Shows idle when nothing runs, a live count while
// jobs run, and backend.down when the backend is unreachable. Hovering reveals
// running + recent jobs.
export function JobIndicator({ online }: { online: boolean }) {
  const { running, recent, now } = useJobs(online)

  if (!online) return <span className="down">● backend.down</span>

  const count = running.length
  const empty = running.length === 0 && recent.length === 0

  return (
    <span className={count > 0 ? 'jobs live' : 'jobs'}>
      <span className="jobs-label">{count === 0 ? '● idle' : `◐ ${count} running`}</span>
      <div className="jobs-pop">
        {empty ? <div className="jobs-empty">no recent processes</div> : null}
        {running.map((j) => (
          <JobRow key={j.id} job={j} now={now} />
        ))}
        {recent.map((j) => (
          <JobRow key={j.id} job={j} now={now} />
        ))}
      </div>
    </span>
  )
}
```

- [ ] **Step 5: Run the moved test + full suite + typecheck/lint**

Run: `pnpm vitest run src/renderer/src/hooks/useJobs.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS (and no dangling import of the deleted test).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/hooks/useJobs.ts src/renderer/src/hooks/useJobs.test.ts src/renderer/src/components/layout/JobIndicator.tsx
git rm --cached src/renderer/src/components/layout/JobIndicator.test.ts 2>/dev/null; true
git commit -m "refactor(jobs): shared useJobs hook; JobIndicator consumes it"
```

---

### Task 7: ProcessesPanel + Dashboard wiring + styles

**Files:**
- Create: `src/renderer/src/components/dashboard/ProcessesPanel.tsx`
- Modify: `src/renderer/src/pages/Dashboard.tsx`
- Modify: `src/renderer/src/index.css` (append a `.proc-*` block)
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: `useJobs`/`formatDuration` (Task 6); `trpc.jobs.cancel`, `trpc.jobs.reveal` (Task 2); `JobView`.
- Produces: `ProcessesPanel` React component.

- [ ] **Step 1: Create the panel component**

Create `src/renderer/src/components/dashboard/ProcessesPanel.tsx`:

```tsx
import { formatDuration, useJobs } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import type { JobView } from '@shared/jobs'

function ProcRow({ job, now }: { job: JobView; now: number }) {
  const cancel = trpc.jobs.cancel.useMutation()
  const reveal = trpc.jobs.reveal.useMutation()
  const elapsed = (job.endedAt ?? now) - job.startedAt
  const icon = job.status === 'running' ? '◐' : job.status === 'done' ? '✓' : '✗'
  return (
    <div className={`proc-row ${job.status}`}>
      <span className="proc-icon">{icon}</span>
      <span className="proc-label">
        {job.label}
        <span className="proc-kind">{job.kind}</span>
      </span>
      <span className="proc-model">{job.model ?? '—'}</span>
      <span className="proc-tokens">{job.tokens != null ? job.tokens.toLocaleString() : '—'}</span>
      <span className="proc-detail">{job.error ?? job.detail ?? ''}</span>
      <span className="proc-time">{formatDuration(elapsed)}</span>
      <span className="proc-actions">
        {job.status === 'running' && job.cancellable ? (
          <button
            type="button"
            className="proc-x"
            aria-label="Abort process"
            onClick={() => cancel.mutate({ jobId: job.id })}
          >
            ✕
          </button>
        ) : null}
        {job.status !== 'running' && job.resultPath ? (
          <button
            type="button"
            className="proc-open"
            aria-label="Open output"
            onClick={() => reveal.mutate({ jobId: job.id })}
          >
            ↗
          </button>
        ) : null}
      </span>
    </div>
  )
}

// Full-width dashboard panel: active processes on top, last 10 completed below,
// with model/tokens/detail meta and cancel/open actions.
export function ProcessesPanel() {
  const { running, recent, now } = useJobs()
  return (
    <div className="panel mt-16">
      <div className="panel-head">
        <span className="ttl">processes</span>
      </div>
      <div className="panel-body">
        <div className="proc-group">active</div>
        {running.length === 0 ? (
          <div className="proc-empty">nothing running</div>
        ) : (
          running.map((j) => <ProcRow key={j.id} job={j} now={now} />)
        )}
        <div className="proc-group proc-group-recent">recent · 10</div>
        {recent.length === 0 ? (
          <div className="proc-empty">no recent processes</div>
        ) : (
          recent.map((j) => <ProcRow key={j.id} job={j} now={now} />)
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the Dashboard**

In `src/renderer/src/pages/Dashboard.tsx`, add the import (with the other component imports at the top):

```ts
import { ProcessesPanel } from '@renderer/components/dashboard/ProcessesPanel'
```

In the `Dashboard` return, insert `<ProcessesPanel />` between the activity grid and the recent/signals grid:

```tsx
        <div className="mt-16" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <ActivityPanel />
          <QuickActions />
        </div>

        <ProcessesPanel />

        <div className="grid-2 mt-16">
          <RecentActivity />
          <SignalsSystem />
        </div>
```

- [ ] **Step 3: Append the panel styles**

Append to `src/renderer/src/index.css`:

```css
/* Dashboard processes panel: rich rows for active + recent jobs. */
.proc-group {
  font-family: var(--mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--fg-4);
  padding: 4px 0;
}
.proc-group-recent {
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 10px;
}
.proc-empty {
  color: var(--fg-3);
  font-size: 12px;
  padding: 6px 2px;
}
.proc-row {
  display: grid;
  grid-template-columns: 16px minmax(160px, 1.4fr) 1.2fr 0.6fr 1.6fr 64px 40px;
  align-items: center;
  gap: 10px;
  padding: 6px 2px;
  font-size: 12px;
  border-bottom: 1px solid var(--line);
}
.proc-row .proc-icon {
  text-align: center;
}
.proc-row.running .proc-icon {
  color: var(--ok);
}
.proc-row.done .proc-icon {
  color: var(--ok);
}
.proc-row.error .proc-icon {
  color: var(--warn);
}
.proc-label {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.proc-kind {
  color: var(--fg-4);
  font-size: 10px;
}
.proc-model,
.proc-detail {
  color: var(--fg-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proc-row.error .proc-detail {
  color: var(--warn);
}
.proc-tokens,
.proc-time {
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.proc-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.proc-x,
.proc-open {
  background: none;
  border: none;
  color: var(--fg-3);
  cursor: pointer;
  padding: 0 2px;
}
.proc-x:hover {
  color: var(--warn);
}
.proc-open:hover {
  color: var(--ok);
}
```

- [ ] **Step 4: Add an e2e check**

Append to `e2e/app.spec.ts`:

```ts
test('Dashboard shows the processes panel', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByText('ATLAS.OS')).toBeVisible()

  await window.getByRole('button', { name: '01 DASHBOARD' }).click()

  // Panel title + both group labels render (idle state is deterministic).
  await expect(window.getByText('processes', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(window.getByText('active', { exact: true })).toBeVisible()
  await expect(window.getByText('nothing running')).toBeVisible()

  await app.close()
})
```

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS (all unit tests).
Run: `pnpm build && pnpm e2e`
Expected: PASS (existing + new Dashboard test).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/dashboard/ProcessesPanel.tsx src/renderer/src/pages/Dashboard.tsx src/renderer/src/index.css e2e/app.spec.ts
git commit -m "feat(jobs): Dashboard processes panel with meta + cancel/open actions"
```

---

## Manual smoke verification (post-implementation)

Run `pnpm dev`, open Dashboard:
1. Idle: panel shows `processes`, `active` → "nothing running", `recent · 10` → "no recent processes".
2. Trigger **Knowledge compile** → an `active` row appears (model `—`, ticking elapsed, no cancel button); on completion it moves to `recent` with `detail` like "2 compiled · 1 up to date".
3. Trigger **News** → `active` row shows the model + ticking elapsed + `✕`; when done it lands in `recent` with a token count and a `↗` button that reveals the output file in Finder.
4. Trigger **Benchmark batch** → the `active` row's `detail` updates live through `3/5 · running → retrying → analyzing`.
5. Click `✕` on a running cancellable row → it moves to `recent` as `✗`.
```
