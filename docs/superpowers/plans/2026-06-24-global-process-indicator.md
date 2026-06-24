# Global Process Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `● backend.ok` string in the top bar with a live indicator of all running/recently-completed Atlas SDK processes, with hover details and an abort button for cancellable ones.

**Architecture:** A single in-memory `JobRegistry` (EventEmitter) in the main process is the source of truth. Every long-running process registers a job on start and finishes it on completion/error. A new `jobs` tRPC router streams snapshots over a subscription and exposes a `cancel` mutation. The renderer's `JobIndicator` (mounted in `TitleBar`) subscribes and renders the dot + hover popover.

**Tech Stack:** TypeScript, Electron, tRPC v11 (`observable` subscriptions over electron-trpc IPC), React, Zustand-free local state, Vitest (unit), Playwright (e2e), Biome (lint).

## Global Constraints

- All UI strings and labels are **English** (only generated digest content may be Russian).
- History is **in-memory only**, capped at the last **10** completed jobs; lost on app restart.
- Per-job info shown: **label + status + elapsed time** only. No progress %, no error text, no file links.
- Abort is offered **only for already-cancellable processes** (agent, news, trending, skill improver, benchmark chat). Compile / query / benchmark / plugins appear as `running` with **no** abort button (`cancellable: false`).
- `'error'` status also represents user-aborted runs (no separate `aborted` status).
- tRPC context is `Record<string, never>` (`t.procedure` only); callers use `appRouter.createCaller({})`.
- No data transformer — payloads cross IPC via structured clone (plain objects, numbers, `null`).
- Follow existing router patterns; import the registry via `@main/services/jobs/registry` and shared types via `@shared/jobs`.
- Run `pnpm test` (vitest), `pnpm typecheck`, `pnpm lint` to verify. Pre-commit hook runs lint + typecheck.

---

### Task 1: Job registry + shared types + trackJob helper

**Files:**
- Create: `src/shared/jobs.ts`
- Create: `src/main/services/jobs/registry.ts`
- Test: `src/main/services/jobs/registry.test.ts`

**Interfaces:**
- Produces:
  - `src/shared/jobs.ts`: `type JobStatus = 'running' | 'done' | 'error'`; `interface JobView { id: string; kind: string; label: string; status: JobStatus; startedAt: number; endedAt: number | null; cancellable: boolean }`; `interface JobsSnapshot { running: JobView[]; recent: JobView[] }`.
  - `src/main/services/jobs/registry.ts`: `class JobRegistry` with `register(opts: RegisterOptions): JobHandle`, `cancel(id: string): boolean`, `snapshot(): JobsSnapshot`, `onChange(listener: () => void): () => void`; `interface RegisterOptions { kind: string; label: string; abort?: () => void }`; `interface JobHandle { id: string; finish(status: 'done' | 'error'): void }`; the singleton `jobRegistry`; and `async function trackJob<T>(reg: JobRegistry, opts: RegisterOptions, work: Promise<T>): Promise<T>`.

- [ ] **Step 1: Create shared types**

Create `src/shared/jobs.ts`:

```ts
// Shared job types for the global process indicator. Plain structurally-cloneable
// shapes — they cross the electron-trpc IPC boundary with no transformer.

// 'error' also represents user-aborted runs (the indicator shows status, not a
// distinct aborted state).
export type JobStatus = 'running' | 'done' | 'error'

// A job as seen by the renderer. Never carries the abort callback; `cancellable`
// is the derived boolean the UI uses to decide whether to render the abort button.
export interface JobView {
  id: string
  kind: string
  label: string
  status: JobStatus
  startedAt: number
  endedAt: number | null
  cancellable: boolean
}

// Payload streamed over jobs.list. `running` first, then the most-recent-first
// ring buffer of completed jobs.
export interface JobsSnapshot {
  running: JobView[]
  recent: JobView[]
}
```

- [ ] **Step 2: Write the failing test**

Create `src/main/services/jobs/registry.test.ts`:

```ts
import { JobRegistry, trackJob } from '@main/services/jobs/registry'
import { describe, expect, it, vi } from 'vitest'

describe('JobRegistry', () => {
  it('exposes a registered job as running, with cancellable from abort', () => {
    const reg = new JobRegistry()
    reg.register({ kind: 'news', label: 'News digest', abort: () => {} })
    reg.register({ kind: 'knowledge.compile', label: 'Knowledge compile' })
    const { running } = reg.snapshot()
    expect(running).toHaveLength(2)
    expect(running.find((j) => j.kind === 'news')?.cancellable).toBe(true)
    expect(running.find((j) => j.kind === 'knowledge.compile')?.cancellable).toBe(false)
    expect(running[0].status).toBe('running')
    expect(running[0].endedAt).toBeNull()
  })

  it('moves a finished job into recent with status + endedAt', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'news', label: 'News digest' })
    job.finish('done')
    const snap = reg.snapshot()
    expect(snap.running).toHaveLength(0)
    expect(snap.recent).toHaveLength(1)
    expect(snap.recent[0].status).toBe('done')
    expect(snap.recent[0].endedAt).not.toBeNull()
    expect(snap.recent[0].cancellable).toBe(false)
  })

  it('is idempotent: finishing twice keeps a single recent entry', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'news', label: 'News digest' })
    job.finish('done')
    job.finish('error')
    expect(reg.snapshot().recent).toHaveLength(1)
    expect(reg.snapshot().recent[0].status).toBe('done')
  })

  it('caps recent at 10, newest first', () => {
    const reg = new JobRegistry()
    for (let i = 0; i < 12; i++) {
      reg.register({ kind: 'k', label: `job-${i}` }).finish('done')
    }
    const { recent } = reg.snapshot()
    expect(recent).toHaveLength(10)
    expect(recent[0].label).toBe('job-11')
    expect(recent[9].label).toBe('job-2')
  })

  it('cancel invokes abort and reports outcome', () => {
    const reg = new JobRegistry()
    const abort = vi.fn()
    const job = reg.register({ kind: 'news', label: 'News digest', abort })
    expect(reg.cancel(job.id)).toBe(true)
    expect(abort).toHaveBeenCalledOnce()
    expect(reg.cancel('nope')).toBe(false)
    const plain = reg.register({ kind: 'k', label: 'no-abort' })
    expect(reg.cancel(plain.id)).toBe(false)
  })

  it('notifies onChange listeners on register and finish, and unsubscribes', () => {
    const reg = new JobRegistry()
    const seen = vi.fn()
    const off = reg.onChange(seen)
    const job = reg.register({ kind: 'k', label: 'x' })
    job.finish('done')
    expect(seen).toHaveBeenCalledTimes(2)
    off()
    reg.register({ kind: 'k', label: 'y' })
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

describe('trackJob', () => {
  it('finishes done and returns the resolved value', async () => {
    const reg = new JobRegistry()
    const result = await trackJob(reg, { kind: 'knowledge.compile', label: 'Knowledge compile' }, Promise.resolve(42))
    expect(result).toBe(42)
    expect(reg.snapshot().recent[0].status).toBe('done')
  })

  it('finishes error and re-throws on rejection', async () => {
    const reg = new JobRegistry()
    await expect(
      trackJob(reg, { kind: 'knowledge.compile', label: 'Knowledge compile' }, Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom')
    expect(reg.snapshot().recent[0].status).toBe('error')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/jobs/registry.test.ts`
Expected: FAIL — cannot find module `@main/services/jobs/registry`.

- [ ] **Step 4: Write the implementation**

Create `src/main/services/jobs/registry.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { JobStatus, JobView, JobsSnapshot } from '@shared/jobs'

// Keep the last N completed jobs in the hover list (in-memory; lost on restart).
const MAX_RECENT = 10

export interface RegisterOptions {
  kind: string
  label: string
  // When present, the job is cancellable and the registry can route cancel(id)
  // to this callback. Absent → the UI shows no abort button.
  abort?: () => void
}

export interface JobHandle {
  id: string
  finish(status: 'done' | 'error'): void
}

interface ActiveJob {
  id: string
  kind: string
  label: string
  startedAt: number
  abort?: () => void
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
    })
    this.emit('change')
    let finished = false
    return {
      id,
      finish: (status) => {
        if (finished) return
        finished = true
        this.complete(id, status)
      },
    }
  }

  private complete(id: string, status: JobStatus): void {
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
    })
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT
    this.emit('change')
  }

  cancel(id: string): boolean {
    const job = this.active.get(id)
    if (!job?.abort) return false
    job.abort()
    return true
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
// `trackJob(...).catch(() => {})`.
export async function trackJob<T>(
  reg: JobRegistry,
  opts: RegisterOptions,
  work: Promise<T>,
): Promise<T> {
  const job = reg.register(opts)
  try {
    const result = await work
    job.finish('done')
    return result
  } catch (err) {
    job.finish('error')
    throw err
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/main/services/jobs/registry.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/jobs.ts src/main/services/jobs/registry.ts src/main/services/jobs/registry.test.ts
git commit -m "feat(jobs): in-memory job registry + trackJob helper"
```

---

### Task 2: jobs tRPC router

**Files:**
- Create: `src/main/trpc/routers/jobs.ts`
- Modify: `src/main/trpc/router.ts:14-30`
- Test: `src/main/trpc/routers/jobs.test.ts`

**Interfaces:**
- Consumes: `jobRegistry` from Task 1; `JobsSnapshot` from `@shared/jobs`.
- Produces: `jobsRouter` with `list` (subscription emitting `JobsSnapshot`) and `cancel` (mutation, input `{ jobId: string }`, output `{ ok: boolean }`); registered on `appRouter` as `jobs`.

- [ ] **Step 1: Write the failing test**

Create `src/main/trpc/routers/jobs.test.ts`:

```ts
import { jobRegistry } from '@main/services/jobs/registry'
import { appRouter } from '@main/trpc/router'
import { describe, expect, it, vi } from 'vitest'

describe('jobs router', () => {
  it('cancel routes to the registry and reports outcome', () => {
    const caller = appRouter.createCaller({})
    const abort = vi.fn()
    const job = jobRegistry.register({ kind: 'news', label: 'News digest', abort })
    expect(caller.jobs.cancel({ jobId: job.id })).toEqual({ ok: true })
    expect(abort).toHaveBeenCalledOnce()
    expect(caller.jobs.cancel({ jobId: 'missing' })).toEqual({ ok: false })
    job.finish('error')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/trpc/routers/jobs.test.ts`
Expected: FAIL — `caller.jobs` is undefined / router not found.

- [ ] **Step 3: Create the router**

Create `src/main/trpc/routers/jobs.ts`:

```ts
import { jobRegistry } from '@main/services/jobs/registry'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { JobsSnapshot } from '@shared/jobs'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

export const jobsRouter = router({
  // Emit a fresh snapshot on subscribe, then on every registry change.
  list: publicProcedure.subscription(() =>
    observable<JobsSnapshot>((emit) => {
      emit.next(jobRegistry.snapshot())
      return jobRegistry.onChange(() => emit.next(jobRegistry.snapshot()))
    }),
  ),

  cancel: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: jobRegistry.cancel(input.jobId) })),
})
```

- [ ] **Step 4: Register the router**

Modify `src/main/trpc/router.ts`. Add the import (alphabetical, after `healthRouter`):

```ts
import { jobsRouter } from '@main/trpc/routers/jobs'
```

Add to the `appRouter` object (after `health: healthRouter,`):

```ts
  jobs: jobsRouter,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/main/trpc/routers/jobs.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck && git add src/main/trpc/routers/jobs.ts src/main/trpc/routers/jobs.test.ts src/main/trpc/router.ts
git commit -m "feat(jobs): jobs tRPC router (list subscription + cancel)"
```

---

### Task 3: Integrate streaming runs (news, trending, agent)

**Files:**
- Modify: `src/main/trpc/routers/news.ts:31-35`
- Modify: `src/main/trpc/routers/trending.ts:31-35`
- Modify: `src/main/trpc/routers/agent.ts` (after `runs.set(input.requestId, run)`)

**Interfaces:**
- Consumes: `jobRegistry`, `trackJob` from `@main/services/jobs/registry`.
- Produces: nothing new; wires three existing runs into the registry. Their `run.done` promise drives finish; abort wraps `run.cancel()`.

These three routers share the same shape: a `run` object with a `run.done` promise and a `run.cancel()` method, created inside the subscription right after `runs.set(...)`. The integration is identical except for `kind`/`label`.

- [ ] **Step 1: Wire news.ts**

In `src/main/trpc/routers/news.ts`, add the import alongside the existing imports:

```ts
import { jobRegistry, trackJob } from '@main/services/jobs/registry'
```

Immediately after `runs.set(input.requestId, run)` (line 35), add:

```ts
      // Mirror the run into the global job registry. Fire-and-forget: this router
      // already owns run.done for its own emit logic, so swallow here.
      trackJob(
        jobRegistry,
        { kind: 'news', label: 'News digest', abort: () => run.cancel() },
        run.done,
      ).catch(() => {})
```

- [ ] **Step 2: Wire trending.ts**

In `src/main/trpc/routers/trending.ts`, add the same import. After `runs.set(input.requestId, run)` (line 35), add:

```ts
      trackJob(
        jobRegistry,
        { kind: 'trending', label: 'Trending digest', abort: () => run.cancel() },
        run.done,
      ).catch(() => {})
```

- [ ] **Step 3: Wire agent.ts**

In `src/main/trpc/routers/agent.ts`, add the same import. After `runs.set(input.requestId, run)`, add:

```ts
        trackJob(
          jobRegistry,
          { kind: 'agent', label: 'Agent run', abort: () => run.cancel() },
          run.done,
        ).catch(() => {})
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (no type errors; Biome clean).

- [ ] **Step 5: Commit**

```bash
git add src/main/trpc/routers/news.ts src/main/trpc/routers/trending.ts src/main/trpc/routers/agent.ts
git commit -m "feat(jobs): track news/trending/agent runs in the registry"
```

---

### Task 4: Integrate interactive sessions (skill improver, benchmark chat)

**Files:**
- Modify: `src/main/trpc/routers/skillImprover.ts:24-65`
- Modify: `src/main/trpc/routers/benchmarkChat.ts:21-55`

**Interfaces:**
- Consumes: `jobRegistry` from `@main/services/jobs/registry`.
- Produces: nothing new. These sessions have no `done` promise at the router layer — lifecycle ends arrive as emitted events (`done`/`aborted`/`error`). Register on start, finish inside the `emit` interceptor on terminal events, and also finish on teardown (idempotent). Abort wraps the run via the existing `runs` map.

- [ ] **Step 1: Wire skillImprover.ts**

In `src/main/trpc/routers/skillImprover.ts`, add the import:

```ts
import { jobRegistry } from '@main/services/jobs/registry'
```

Inside the `start` subscription, register the job right after `const model = ...` (before `const run = startImproverRun(...)`):

```ts
        const job = jobRegistry.register({
          kind: 'skill.improve',
          label: 'Skill improver',
          // Resolve via the runs map so we don't reference `run` before its
          // declaration; cancel reverts the workspace.
          abort: () => runs.get(input.requestId)?.cancel(),
        })
```

In the `emit` callback, finish the job on terminal events. Replace the existing `emit` body so the terminal branch also finishes the job:

```ts
          emit: (event) => {
            // Log a stats event when the session ends (applied or reverted) so the
            // run shows up in Stats — the tokens/time were spent either way.
            if (event.type === 'done' || event.type === 'aborted') {
              db()
                .insert(events)
                .values({
                  type: 'skill.improve',
                  model,
                  tokens: event.tokens,
                  durationMs: event.durationMs,
                })
                .run()
              logger.info('Skill improvement recorded', {
                skillId: input.skillId,
                applied: event.type === 'done',
                tokens: event.tokens,
                durationMs: event.durationMs,
              })
              job.finish(event.type === 'done' ? 'done' : 'error')
            }
            if (event.type === 'error') job.finish('error')
            emit.next(event)
          },
```

In the teardown `return () => { ... }`, add a final `job.finish('error')` (idempotent — no-op if already finished) after the existing cleanup:

```ts
        return () => {
          const r = runs.get(input.requestId)
          if (r) {
            r.cancel()
            runs.delete(input.requestId)
          }
          job.finish('error')
        }
```

- [ ] **Step 2: Wire benchmarkChat.ts**

In `src/main/trpc/routers/benchmarkChat.ts`, add the import:

```ts
import { jobRegistry } from '@main/services/jobs/registry'
```

Inside the `start` subscription, register the job after the `seed`/`model` are computed but before `const run = startBenchmarkChat(...)` (this is **after** the `if (!analysis) { ... return }` guard, so a missing-analysis early-out never creates a job):

```ts
        const job = jobRegistry.register({
          kind: 'benchmark.chat',
          label: 'Benchmark chat',
          abort: () => runs.get(input.requestId)?.cancel(),
        })
```

Update the `emit` callback to finish on terminal events:

```ts
          emit: (event) => {
            if (event.type === 'error' || event.type === 'aborted') {
              logger.info('Benchmark chat ended', { type: event.type })
            }
            if (event.type === 'done') job.finish('done')
            if (event.type === 'error' || event.type === 'aborted') job.finish('error')
            emit.next(event)
          },
```

Update the teardown to finish the job:

```ts
        return () => {
          const r = runs.get(input.requestId)
          if (r) {
            r.cancel()
            runs.delete(input.requestId)
          }
          job.finish('error')
        }
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/skillImprover.ts src/main/trpc/routers/benchmarkChat.ts
git commit -m "feat(jobs): track skill-improver and benchmark-chat sessions"
```

---

### Task 5: Integrate non-cancellable processes (knowledge compile/query, benchmark batch, plugins)

**Files:**
- Modify: `src/main/trpc/routers/knowledge.ts:66-75`
- Modify: `src/main/trpc/routers/plugins.ts:18-24`
- Modify: `src/main/services/benchmark/batch.ts:52-79,212-228`

**Interfaces:**
- Consumes: `jobRegistry`, `trackJob` from `@main/services/jobs/registry`; `JobHandle` for the benchmark path.
- Produces: nothing new. These have no `abort` callback, so they render as `running` with no abort button.

- [ ] **Step 1: Wire knowledge.ts (compile + query)**

In `src/main/trpc/routers/knowledge.ts`, add the import:

```ts
import { jobRegistry, trackJob } from '@main/services/jobs/registry'
```

Replace the `query` mutation (lines 66-71) with:

```ts
  query: publicProcedure
    .input(projectInput.extend({ q: z.string().min(1) }))
    .output(z.object({ answer: z.string() }))
    .mutation(async ({ input }) => ({
      answer: await trackJob(
        jobRegistry,
        { kind: 'knowledge.query', label: 'Knowledge search' },
        runQuery(storeRoot(), input.project, input.q),
      ),
    })),
```

Replace the `compileAll` mutation (lines 73-75) with:

```ts
  compileAll: publicProcedure
    .output(z.array(compileResultSchema))
    .mutation(() =>
      trackJob(
        jobRegistry,
        { kind: 'knowledge.compile', label: 'Knowledge compile' },
        compileAll(storeRoot(), tracked()),
      ),
    ),
```

- [ ] **Step 2: Wire plugins.ts (checkUpdates + update)**

In `src/main/trpc/routers/plugins.ts`, add the import:

```ts
import { jobRegistry, trackJob } from '@main/services/jobs/registry'
```

Replace the `checkUpdates` mutation (line 19) with:

```ts
  // Network I/O (refreshes marketplaces) — gated behind an explicit user action.
  checkUpdates: publicProcedure
    .output(z.array(updateInfoSchema))
    .mutation(() =>
      trackJob(jobRegistry, { kind: 'plugins', label: 'Plugin update check' }, checkUpdates()),
    ),
```

Replace the `update` mutation (lines 21-24) with:

```ts
  update: publicProcedure
    .input(idInput)
    .output(updateResultSchema)
    .mutation(({ input }) =>
      trackJob(jobRegistry, { kind: 'plugins', label: 'Plugin update' }, updatePlugin(input.id)),
    ),
```

(`setEnabled` is a fast local toggle — intentionally not tracked, to avoid indicator noise.)

- [ ] **Step 3: Wire benchmark batch.ts**

In `src/main/services/benchmark/batch.ts`, add the import:

```ts
import { type JobHandle, jobRegistry } from '@main/services/jobs/registry'
```

In `startBatch`, register a job and pass the handle to `runLoop`. Replace lines 67-69:

```ts
  batches.set(batchId, progress)
  latestBatchId = batchId
  const job = jobRegistry.register({ kind: 'benchmark', label: 'Benchmark batch' })
  void runLoop(batchId, tasks, k, model, progress, job)
```

Extend the `runLoop` signature (line 73-79) to accept the handle:

```ts
async function runLoop(
  batchId: string,
  tasks: BenchmarkTask[],
  k: number,
  model: string,
  progress: Progress,
  job: JobHandle,
): Promise<void> {
```

In `runLoop`'s `finally` block (lines 215-228), finish the job based on whether the loop crashed. Add at the very start of the `finally` block (before `progress.running = false`):

```ts
  } finally {
    job.finish(progress.error ? 'error' : 'done')
    progress.running = false
    progress.phase = 'done'
```

- [ ] **Step 4: Typecheck + lint + existing tests**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run src/main/services/benchmark`
Expected: PASS (benchmark unit tests unaffected — `runLoop` is internal; `startBatch` still returns `{ batchId, total }`).

- [ ] **Step 5: Commit**

```bash
git add src/main/trpc/routers/knowledge.ts src/main/trpc/routers/plugins.ts src/main/services/benchmark/batch.ts
git commit -m "feat(jobs): track compile/query/benchmark/plugin processes"
```

---

### Task 6: JobIndicator component + TitleBar wiring + styles

**Files:**
- Create: `src/renderer/src/components/layout/JobIndicator.tsx`
- Test: `src/renderer/src/components/layout/JobIndicator.test.ts`
- Modify: `src/renderer/src/components/layout/TitleBar.tsx:55-62`
- Modify: `src/renderer/src/index.css` (append a `.jobs` block)

**Interfaces:**
- Consumes: `trpc.jobs.list` subscription + `trpc.jobs.cancel` mutation; `JobView`, `JobsSnapshot` from `@shared/jobs`.
- Produces: `export function JobIndicator({ online }: { online: boolean })`; `export function formatDuration(ms: number): string` (pure, unit-tested).

- [ ] **Step 1: Write the failing test for formatDuration**

Create `src/renderer/src/components/layout/JobIndicator.test.ts`:

```ts
import { formatDuration } from '@renderer/components/layout/JobIndicator'
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

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/renderer/src/components/layout/JobIndicator.test.ts`
Expected: FAIL — cannot find module `JobIndicator`.

- [ ] **Step 3: Create the component**

Create `src/renderer/src/components/layout/JobIndicator.tsx`:

```tsx
import { trpc } from '@renderer/lib/trpc'
import type { JobView, JobsSnapshot } from '@shared/jobs'
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

// Top-bar process indicator. Replaces the static backend.ok string: shows idle
// when nothing runs, a live count while jobs run, and backend.down when the
// backend is unreachable. Hovering reveals running + recent jobs.
export function JobIndicator({ online }: { online: boolean }) {
  const [snap, setSnap] = useState<JobsSnapshot>(EMPTY)
  trpc.jobs.list.useSubscription(undefined, {
    onData: (data) => setSnap(data),
  })

  // Tick once a second only while something is running, to advance the live
  // elapsed counters without a server round-trip.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (snap.running.length === 0) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [snap.running.length])

  if (!online) return <span className="down">● backend.down</span>

  const count = snap.running.length
  const now = Date.now()
  const empty = snap.running.length === 0 && snap.recent.length === 0

  return (
    <span className={`jobs ${count > 0 ? 'live' : ''}`}>
      <span className="jobs-label">{count === 0 ? '● idle' : `◐ ${count} running`}</span>
      <div className="jobs-pop">
        {empty ? <div className="jobs-empty">no recent processes</div> : null}
        {snap.running.map((j) => (
          <JobRow key={j.id} job={j} now={now} />
        ))}
        {snap.recent.map((j) => (
          <JobRow key={j.id} job={j} now={now} />
        ))}
      </div>
    </span>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/renderer/src/components/layout/JobIndicator.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into TitleBar**

In `src/renderer/src/components/layout/TitleBar.tsx`, add the import:

```ts
import { JobIndicator } from '@renderer/components/layout/JobIndicator'
```

Replace the backend-status `<span>` (lines 58-60):

```tsx
        <span className={online ? 'live' : 'down'}>
          {online ? '● backend.ok' : '● backend.down'}
        </span>
```

with:

```tsx
        <JobIndicator online={online} />
```

- [ ] **Step 6: Add styles**

Append to `src/renderer/src/index.css`:

```css
/* Top-bar process indicator. The popover is hover-revealed; anchored to the
   indicator so it hangs below the title bar. */
.jobs {
  position: relative;
  cursor: default;
}
.jobs .jobs-label {
  color: var(--ok);
}
.jobs.live .jobs-label {
  color: var(--accent, var(--ok));
}
.jobs-pop {
  display: none;
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 6px;
  min-width: 240px;
  max-width: 360px;
  padding: 6px;
  background: var(--bg-1, #15161a);
  border: 1px solid var(--fg-4, #333);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 100;
}
.jobs:hover .jobs-pop {
  display: block;
}
.jobs-empty {
  color: var(--fg-3);
  padding: 6px 8px;
  font-size: 12px;
}
.jobs-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  font-size: 12px;
  white-space: nowrap;
}
.jobs-row .jobs-icon {
  width: 12px;
  text-align: center;
}
.jobs-row.running .jobs-icon {
  color: var(--accent, var(--ok));
}
.jobs-row.done .jobs-icon {
  color: var(--ok);
}
.jobs-row.error .jobs-icon {
  color: var(--warn);
}
.jobs-row .jobs-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.jobs-row .jobs-time {
  color: var(--fg-3);
  font-variant-numeric: tabular-nums;
}
.jobs-x {
  background: none;
  border: none;
  color: var(--fg-3);
  cursor: pointer;
  padding: 0 2px;
}
.jobs-x:hover {
  color: var(--warn);
}
```

- [ ] **Step 7: Typecheck + lint + full unit suite**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS (all unit tests green; no type or lint errors).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/layout/JobIndicator.tsx src/renderer/src/components/layout/JobIndicator.test.ts src/renderer/src/components/layout/TitleBar.tsx src/renderer/src/index.css
git commit -m "feat(jobs): JobIndicator in the top bar with hover details + abort"
```

---

### Task 7: e2e smoke test

**Files:**
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: the built app (`pnpm build`) with the JobIndicator wired in.
- Produces: an e2e test asserting the indicator renders `● idle` at boot.

Note: a real `running` state requires triggering compile/news (needs `uv` / the Claude CLI and spends tokens) — too heavy and nondeterministic for CI. This test verifies the indicator mounts and reaches the idle state (proving the subscription round-trips). The `running` + abort flow is left to manual smoke verification.

- [ ] **Step 1: Add the e2e test**

Append to `e2e/app.spec.ts`:

```ts
test('top bar shows the process indicator at idle', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await expect(window.getByText('ATLAS.OS')).toBeVisible()

  // The JobIndicator subscribes to jobs.list and settles to idle when nothing
  // is running — proves the subscription round-trips over IPC.
  await expect(window.getByText('● idle')).toBeVisible({ timeout: 15000 })

  await app.close()
})
```

- [ ] **Step 2: Build + run e2e**

Run: `pnpm build && pnpm e2e`
Expected: PASS — all existing tests plus the new idle-indicator test.

- [ ] **Step 3: Commit**

```bash
git add e2e/app.spec.ts
git commit -m "test(e2e): top bar process indicator renders at idle"
```

---

## Manual smoke verification (post-implementation)

After all tasks, run `pnpm dev` and verify:
1. Idle: top bar shows `● idle`; hovering shows "no recent processes".
2. Trigger **Knowledge compile** → indicator switches to `◐ 1 running`; hover shows "Knowledge compile" with a ticking timer and **no** abort button; on completion it moves to recent as `✓` (or `✗` on failure).
3. Trigger **News** run → hover shows "News digest" with a `✕` button; clicking `✕` aborts the run and it lands in recent as `✗`.
4. Stop the backend (or force `health` error) → indicator falls back to `● backend.down`.
```
