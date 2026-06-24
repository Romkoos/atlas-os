# Global Process Indicator — Design

**Date:** 2026-06-24
**Status:** Approved (pending spec review)

## Problem

The top bar (`TitleBar.tsx:58-60`) shows a static `● backend.ok` string that
carries little value. The user wants a **system-wide indicator, visible on every
page**, that shows when any Atlas SDK process is running (e.g. knowledge
compilation). On mouseover it should reveal a list of running and recently
completed processes, show whether finished ones succeeded or errored, and let
the user abort a running process.

## Background — current state

There is **no central process registry**. Each tRPC router keeps its own
`Map<requestId, …>` and surfaces progress differently:

| Process | Trigger | How spawned | Progress today | Cancellable today |
|---|---|---|---|---|
| Agent run | `agent.run` subscription | SDK `query()` | token stream | ✅ |
| News digest | `news.run` subscription | SDK `query()` | token stream | ✅ |
| Trending digest | `trending.run` subscription | SDK `query()` | token stream | ✅ |
| Skill improver | `skillImprover.start` subscription | SDK `query()` + mailbox | stream + own UI | ✅ |
| Benchmark chat | `benchmarkChat.start` subscription | SDK `query()` + mailbox | stream + own UI | ✅ |
| Benchmark batch | `benchmark.run` mutation | detached `runLoop()` | poll `benchmark.progress` | ❌ |
| Knowledge compile | `knowledge.compileAll` mutation | `execFile` uv/python (awaited) | blocking response | ❌ |
| Knowledge query | `knowledge.query` mutation | `execFile` uv/python (awaited) | blocking response | ❌ |
| Plugin ops | `plugins.*` mutations | `execFile` claude CLI (awaited) | blocking response | ❌ |

Top-bar health is computed by `health.ping` (`TitleBar.tsx:29-31`), polled every
5s.

## Decisions (from brainstorming)

- **Scope:** track **all** Atlas SDK processes — background jobs *and* the
  interactive sessions (skill improver, benchmark chat).
- **History:** keep the last **N = 10** completed processes **in memory**; lost
  on app restart.
- **Per-process info shown:** **name + status + elapsed time** only. (No live
  progress details, no summary/error-text/file links in this iteration. Status
  alone conveys done vs error.)
- **Abort:** only for processes that are **already cancellable** today (agent,
  news, trending, skill improver, benchmark chat). Compile / query / benchmark /
  plugin ops appear as `running` but have **no** abort button.

## Architecture

### Central job registry (main process)

New singleton module `src/main/services/jobs/registry.ts` — the single source of
truth.

- Holds `Map<jobId, Job>` of active jobs plus a bounded ring buffer of the last
  `N = 10` completed jobs. Entirely in-memory.
- `Job` shape:
  ```ts
  type JobStatus = 'running' | 'done' | 'error'
  interface Job {
    id: string          // registry-generated
    kind: string        // 'knowledge.compile' | 'benchmark' | 'news' | ...
    label: string       // human-readable, e.g. 'Knowledge compile'
    status: JobStatus
    startedAt: number    // epoch ms
    endedAt?: number     // epoch ms, set on finish
  }
  ```
- API:
  - `register({ kind, label, abort? }) → handle` where
    `handle.finish(status: 'done' | 'error')`. The optional `abort?: () => void`
    callback is stored so the registry can route cancellation. If `abort` is
    omitted, the job is non-cancellable and the UI shows no abort button.
  - `cancel(jobId)` → invokes the stored `abort()` for that job if present;
    no-op for unknown id or job without `abort`.
  - `snapshot() → { running: Job[]; recent: Job[] }`.
- Extends `EventEmitter`; emits a `'change'` event after every mutation so the
  tRPC subscription can push a fresh snapshot.
- On `finish`, the job moves from the active map into the ring buffer with
  `endedAt` set; buffer is trimmed to the newest `N`.

### tRPC `jobs` router

New router `src/main/trpc/routers/jobs.ts`, registered in `router.ts`:

- `jobs.list` — **subscription**. On subscribe, emits the current snapshot, then
  re-emits on every registry `'change'` event. Payload:
  `{ running: Job[]; recent: Job[] }`.
- `jobs.cancel` — **mutation**, input `{ jobId: string }`, calls
  `registry.cancel(jobId)`. Returns `{ ok: true }`.

### Integration per process

Each process wraps its lifecycle around the registry:

- On start: `const job = registry.register({ kind, label, abort? })`.
- On normal completion: `job.finish('done')`.
- On error / abort: `job.finish('error')` (abort counts as error for status
  purposes — kept simple per "name + status + elapsed").
- Wrap in `try/finally` so a process that throws or dies without an explicit
  finish still resolves to `finish('error')`.

Mapping:

| kind | label | Where to wire | abort callback |
|---|---|---|---|
| `agent` | Agent run | `agent.ts` run lifecycle | existing `cancel()` |
| `news` | News digest | `news.ts` | existing `cancel()` |
| `trending` | Trending digest | `trending.ts` | existing `cancel()` |
| `skill.improve` | Skill improver | `skillImprover/run.ts` | existing `cancel()` |
| `benchmark.chat` | Benchmark chat | `benchmarkChat/run.ts` | existing `cancel()` |
| `benchmark` | Benchmark batch | `benchmark/batch.ts` `runLoop` | none |
| `knowledge.compile` | Knowledge compile | `knowledge/store.ts` compileAll | none |
| `knowledge.query` | Knowledge query | `knowledge/store.ts` query | none |
| `plugins` | Plugin operation | `plugins/cli.ts` ops | none |

Note: the registry stores no `requestId`/`abort` details in the snapshot sent to
the renderer. The snapshot carries a derived boolean `cancellable` per job
(true iff an `abort` callback is registered) so the UI knows whether to render
the `✕` button.

## Frontend — JobIndicator

Replace the `● backend.ok` span in `TitleBar.tsx` with a `JobIndicator`
component that subscribes to `jobs.list`.

States (the dot + label in the top bar):

- **Idle** (connected, nothing running): `● idle`, green dot.
- **Running** (≥1 job running): animated dot + count, e.g. `◐ 2 running`.
- **Backend down** (subscription/health errored): `● backend.down`, warn color.
  Health is not removed — it occupies the same slot as a fallback. tRPC's
  existing reconnect handles recovery.

**Hover → popover** listing running jobs first, then recent:

- Status icon: spinner (running) / ✓ (done) / ✗ (error).
- Name (label) + elapsed time:
  - running → **live ticking counter**, computed client-side from `startedAt`
    via a local interval; the server does not push per-second updates.
  - finished → final duration (`endedAt - startedAt`).
- Trailing `✕` button on running jobs **iff** `cancellable` is true; click calls
  `jobs.cancel({ jobId })`.

## Error handling

- Process dies without `finish` → `try/finally` guarantees `finish('error')`.
- `cancel` on unknown/non-cancellable job → no-op.
- Subscription drops → UI shows `backend.down`; tRPC reconnects and re-emits the
  snapshot.
- Ring buffer never grows beyond `N`; oldest completed entries are evicted.

## Testing

- **Unit (registry):** register/finish/cancel; buffer trimmed to `N`;
  `finally`-on-error path sets `error`; `cancel` routes to stored `abort`;
  `cancel` of unknown id is a no-op; `cancellable` derived correctly.
- **e2e:**
  - Trigger knowledge compile → TitleBar shows `running` (string `running`) →
    settles to a recent `done` entry on hover.
  - Trigger news run, hover, click `✕` → job ends as `error`/aborted and leaves
    the running list.
- **Brand strings for e2e:** `idle`, `running`.

## Out of scope (YAGNI for this iteration)

- Persisting job history across restarts (DB-backed history).
- Per-process live progress details (token counts, done/total, phase).
- Inline summary / error text / output-file links in the popover.
- Adding cancellation to compile / query / benchmark / plugin ops.
