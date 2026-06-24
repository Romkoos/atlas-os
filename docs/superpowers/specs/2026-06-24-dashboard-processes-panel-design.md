# Dashboard Processes Panel — Design

**Date:** 2026-06-24
**Status:** Approved (pending spec review)
**Builds on:** `2026-06-24-global-process-indicator-design.md` (the in-memory `JobRegistry` + `jobs` tRPC router + top-bar `JobIndicator`).

## Problem

The top-bar indicator is intentionally compact (name + status + elapsed in a hover popover). The user wants a richer, always-visible view on the **Dashboard** page: a panel listing **active processes** and the **last 10 completed**, with additional per-process metadata, and a cancel action where the process supports it.

## Background — current state

- `JobRegistry` (`src/main/services/jobs/registry.ts`) is the in-memory source of truth: a map of active jobs + a ring buffer of the last 10 completed. It exposes `register`, `cancel`, `snapshot`, `onChange`, plus the `trackJob` helper.
- `JobView` currently carries only `id, kind, label, status, startedAt, endedAt, cancellable`.
- The `jobs` tRPC router exposes `jobs.list` (subscription streaming `{ running, recent }`) and `jobs.cancel`.
- Nine process kinds register today: `news`, `trending`, `agent`, `skill.improve`, `benchmark.chat`, `benchmark`, `benchmark.analyze`, `knowledge.compile`, `knowledge.query`, `plugins`.
- The Dashboard page (`src/renderer/src/pages/Dashboard.tsx`, section `dashboard`) is built from `.panel`/`.panel-head`/`.panel-body` blocks. Current layout: `StatusRow` (KPIs) → `[ActivityPanel | QuickActions]` → `[RecentActivity | SignalsSystem]`.
- `revealInFinder(filePath)` exists in `src/main/services/files.ts` (`shell.showItemInFolder`).

## Decisions (from brainstorming)

- **Additional info = full meta:** model, tokens, output file (openable), error message, and live progress (e.g. benchmark `done/total · phase`).
- **Placement:** a single **full-width** panel inserted **between** the `[Activity | QuickActions]` row and the `[RecentActivity | SignalsSystem]` row (the latter moves down). `active` section on top, `recent · 10` below.
- **Cancel** only where the job is `cancellable` (unchanged from the registry's existing derivation).

## Architecture

### Part 1 — Registry data-model extension

Extend `JobView` in `src/shared/jobs.ts` (all new fields present, nullable, structurally-cloneable):

```ts
export interface JobView {
  id: string
  kind: string
  label: string
  status: JobStatus
  startedAt: number
  endedAt: number | null
  cancellable: boolean
  model: string | null        // e.g. 'claude-sonnet-4-6'; null for python/plugin ops
  detail: string | null       // live text, e.g. '3/5 · analyzing' or a compile summary
  tokens: number | null       // output tokens where reported
  resultPath: string | null   // openable output file, else null
  error: string | null        // message when status === 'error'
}
```

Registry (`src/main/services/jobs/registry.ts`) changes:

```ts
export interface RegisterOptions {
  kind: string
  label: string
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
  update(patch: { detail?: string | null; tokens?: number | null }): void
  finish(status: 'done' | 'error', meta?: FinishMeta): void
}
```

- `ActiveJob` gains `model`, `detail`, `tokens` (defaulting to `null`).
- `register` stores `model`/`detail` from options.
- `update(patch)` mutates the active job's `detail`/`tokens` (only provided keys) and emits `change`. No-op if the job is already finished/absent.
- `finish(status, meta?)` merges `meta` into the recent `JobView` it creates: `tokens`, `resultPath`, `error`, and `detail` (falling back to the active job's last `detail`). Idempotent (existing `finished` guard).
- `snapshot()` populates all new fields for both `running` (from the active job; `endedAt: null`, `error: null`, `resultPath: null`) and `recent` (from stored values).
- `getResultPath(id): string | null` — looks up `id` in active then recent; returns `resultPath` or `null`.

`trackJob` gains an optional result mapper:

```ts
export async function trackJob<T>(
  reg: JobRegistry,
  opts: RegisterOptions,
  work: Promise<T>,
  mapResult?: (r: T) => FinishMeta,
): Promise<T> {
  const job = reg.register(opts)
  try {
    const r = await work
    job.finish('done', mapResult ? mapResult(r) : undefined)
    return r
  } catch (err) {
    job.finish('error', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
```

### Part 2 — Integration (where each field comes from)

| kind | model | tokens | resultPath | live detail | wiring |
|---|---|---|---|---|---|
| `news` | settings model | `outputTokens` | `filePath` | — | `trackJob` + `mapResult` on `run.done` |
| `trending` | settings model | `outputTokens` | `filePath` | — | `trackJob` + `mapResult` on `run.done` |
| `agent` | `input.model` | `outputTokens` | saved md path | — | manual: `register` at start, `finish` in existing `.then` (has filePath+tokens) / `.catch` |
| `skill.improve` | settings model | event `tokens` | — | — | manual: `finish` in emit interceptor (done/aborted carry tokens) |
| `benchmark.chat` | settings model | — | — | — | manual: `finish` in emit interceptor |
| `benchmark` | batch model | — | — | `${done}/${total} · ${phase}` | manual: `register` in `startBatch`, `update` in `runLoop`, `finish` in `finally` |
| `benchmark.analyze` | batch model | — | — | — | `trackJob` |
| `knowledge.compile` | — | — | — | summary e.g. `"2 compiled · 1 error"` | `trackJob` + `mapResult` over `CompileResult[]` |
| `knowledge.query` | — | — | — | truncated query text | `trackJob`; `detail` set at `register` |
| `plugins` | — | — | — | plugin id / `"update check"` | `trackJob`; `detail` at `register` |

Notes:
- **agent** changes from the current fire-and-forget `trackJob(run.done)` (Task 3 of the prior feature) to a manual `register`/`finish` so the saved markdown path and token count are captured. The job is finished `done` in the success branch (with `tokens` + `resultPath`), `error` in the failure branch, and `error` on the cancelled/aborted branch.
- **benchmark** `detail` is recomputed and pushed via `job.update({ detail })` whenever `progress.done` or `progress.phase` changes within `runLoop`; the `finally` finishes with `error` (from `progress.error`) or `done`, and a final `detail`.
- `knowledge.compile` summary helper counts statuses from the returned `CompileResult[]` (`compiled`/`nothing`/`error`).
- Where `model` is not meaningful (python/plugin ops), it is `null` and the UI shows `—`.

### Part 3 — Backend: jobs router

Add to `src/main/trpc/routers/jobs.ts`:

```ts
reveal: publicProcedure
  .input(z.object({ jobId: z.string().min(1) }))
  .output(z.object({ ok: z.boolean() }))
  .mutation(({ input }) => {
    const path = jobRegistry.getResultPath(input.jobId)
    if (path) revealInFinder(path)
    return { ok: Boolean(path) }
  }),
```

`jobs.list` and `jobs.cancel` are unchanged (the streamed `JobView` is simply richer now). Reveal takes a `jobId`, not a path — the renderer can never ask to reveal an arbitrary filesystem path.

### Part 4 — Renderer

**Shared hook** `src/renderer/src/hooks/useJobs.ts`:
- Subscribes to `trpc.jobs.list` (gated `online`? — the hook takes an `online` arg defaulting to `true`; the top-bar passes its health-derived `online`, the panel passes `true`).
- Holds the latest `JobsSnapshot` in local state via `onData`.
- Runs a 1s `setInterval` only while `running.length > 0`, exposing a `now` timestamp for live elapsed.
- Returns `{ running, recent, now }`.

Refactor the existing `JobIndicator` to consume `useJobs(online)` (removing its duplicated subscription + tick), keeping its current rendering and `skipToken` offline-gating behavior (the hook applies `skipToken` when `online` is false).

**New component** `src/renderer/src/pages/dashboard/ProcessesPanel.tsx` (or colocated with Dashboard):
- A full-width `.panel` with `.panel-head` titled `processes`.
- `.panel-body` contains two labelled groups: `active` (`running`) and `recent · 10` (`recent`).
- Each group renders rows. A row shows: status icon (`◐` running / `✓` done / `✗` error), `label` with dim `kind`, `model` (or `—`), `tokens` (or `—`), `detail` (or empty), elapsed (live `formatDuration(now - startedAt)` for running, `formatDuration(endedAt - startedAt)` for completed), and an actions cell:
  - running + `cancellable` → `✕` button calling `trpc.jobs.cancel.useMutation().mutate({ jobId })`.
  - recent + `resultPath` → `↗` button calling `trpc.jobs.reveal.useMutation().mutate({ jobId })`.
  - status `error` → the `error` message shown inline (muted/warn color).
- Empty states: `active` shows "nothing running"; `recent` shows "no recent processes".
- `formatDuration` moves into `src/renderer/src/hooks/useJobs.ts` and is imported by both `JobIndicator` and `ProcessesPanel` (its existing unit test moves to `useJobs.test.ts`). `JobIndicator` re-exports nothing; both components import `formatDuration` from the hook module.

**Dashboard wiring** (`src/renderer/src/pages/Dashboard.tsx`): insert `<ProcessesPanel />` as a full-width row between the `[ActivityPanel | QuickActions]` grid and the `[RecentActivity | SignalsSystem]` grid.

### Part 5 — Error handling

- `update`/`finish` after completion → no-op (idempotency guard).
- `reveal` unknown jobId or `null` path → `{ ok: false }`, no shell call.
- `cancel` unknown/non-cancellable → `{ ok: false }` (unchanged).
- The panel degrades gracefully: empty snapshot → both empty states.

## Testing

- **Unit (registry):**
  - `register` stores `model`/`detail`; `snapshot().running` exposes them.
  - `update({ detail, tokens })` mutates the active job and emits `change`; ignores keys not provided; no-op after finish.
  - `finish('done', { tokens, resultPath })` and `finish('error', { error })` merge into the recent entry; `detail` falls back to last `update` value.
  - `trackJob` with `mapResult` sets meta on success; sets `error` from the thrown message on rejection.
  - `getResultPath` returns the path for an active job, a recent job, and `null` for unknown.
- **Unit (renderer):** `formatDuration` (existing tests move with it if relocated) plus, if feasible, a pure `compileSummary(results)` helper test for the knowledge.compile detail string.
- **e2e:** Dashboard renders the processes panel with the `active` and `recent` group labels at boot (deterministic). Live runs (showing a real running row, cancel, reveal) remain manual smoke — triggering real SDK work in CI is heavy/nondeterministic, consistent with the prior feature's e2e scope.

## Out of scope (YAGNI)

- Persisting job history/metadata across app restarts (still in-memory).
- Streaming per-token output into the panel (the panel shows summary meta, not live token text).
- Reveal/open for processes without a `resultPath` (compile/query/benchmark/plugins).
- Pause/resume or re-run actions.
