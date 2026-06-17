# Benchmark Post-Run Experience — Design Spec

**Date:** 2026-06-17
**Status:** Approved (brainstorming) → ready for implementation plan
**Area:** atlas-os benchmark suite (`src/main/services/benchmark/*`, `src/renderer/.../Productivity.tsx`)

## Problem

A benchmark batch runs strictly sequentially (`tasks.length × k` runs, each up to 5 min/turn) and can take hours. Parallelizing runs was rejected: it destroys measurement fidelity (cache-read tokens go to zero before cache warms; wall-time becomes meaningless under contention; a single OAuth can't sustain concurrent headless sessions). See knowledge store `concepts/benchmark-measurement-bias` and `concepts/benchmark-timeout-architecture`.

Instead of making the run faster, we remove the *waiting* and add a useful post-run experience:

1. **Live partial results** — results table fills in as runs complete, not all-at-once at the end.
2. **Completion notification** — a native OS notification when the batch finishes, so the user can walk away.
3. **Transient retry sweep** — at the end of the batch, re-run runs that failed for transient reasons.
4. **Auto-analysis** — a one-shot LLM call explains the A/B effect of the infra change in 2-3 plain-language sentences, persisted until the next batch.
5. **Discuss chat** — an in-app chat window, seeded with the analysis + A/B data and read-only repo tools, to discuss the conclusion with the model.

## Non-Goals

- No parallel/concurrent run execution (explicitly rejected — breaks measurement).
- No change to how individual runs or turns are measured (`runner.ts` metric accounting unchanged).
- No retry of `assertion_failed` or `rate_limited` runs (they are real signals, not failures).
- No new chat surface beyond reusing the existing skill-improver streaming pattern.

## Current State (reference)

- **Loop:** `src/main/services/benchmark/batch.ts:78-122` — nested `for (task)` / `for (rep)`, each `await runBenchmarkTask(...)`. Inline one-retry on transient (`timeout`/`sdk_error`) at `batch.ts:85-94`. Each run inserts a `benchmarkRuns` row immediately (`batch.ts:95-118`).
- **Progress:** in-memory `Map<batchId, Progress>` (`batch.ts:27`); `Progress = { batchId, total, done, failed, running, error }`.
- **Runner:** `src/main/services/benchmark/runner.ts` — dynamic `import('@anthropic-ai/claude-agent-sdk')`, `query({ prompt, options })` with `baseOptions = { model, settingSources, allowedTools (default Read/Grep/Glob), permissionMode: 'bypassPermissions', cwd: repoRoot, env: subscriptionEnv() }`.
- **failReason values:** `sdk_error`, `assertion_failed`, `timeout`, `rate_limited` (`types.ts`); `success = gate.valid` (`gate.ts`).
- **DB:** `benchmarkRuns` table (`src/main/db/schema.ts:128-162`). No batch/analysis table exists.
- **tRPC:** `src/main/trpc/routers/benchmark.ts` — `tasks`, `run`, `progress` (polls 2s), `latest` (polls 2s), `results` (groups all runs by `(taskId, infraHash, model)` with medians/deltas), `infraCompare`, `clearCompareBaseline`, `wipeRuns`.
- **UI:** `src/renderer/src/pages/Productivity.tsx` — `BenchmarkTab` (lines ~1940-2187); `results`/`infraCompare` invalidated only when batch completes (`1978-1983`).
- **Improver chat pattern (to reuse):**
  - Backend: `src/main/services/skillImprover/run.ts` (`startImproverRun`, mailbox at `skillImprover/mailbox.ts`), router `src/main/trpc/routers/skillImprover.ts` (`.start` subscription, `.reply`/`.accept`/`.reject`/`.cancel` mutations), event type `src/shared/ipc-events.ts:18-30`.
  - Frontend: store `src/renderer/src/store/skillImproverRun.ts`, App-level host `src/renderer/src/components/SkillImproverHost.tsx`, overlay `Skills.tsx:260-357`.

## Design

### Component 1 — Live partial results

**Change:** In `BenchmarkTab`, while `progress.running` is true, refetch the `results` query on the same 2s cadence already used for `progress`/`latest` (add `refetchInterval` or invalidate `results` inside the progress-poll effect). Keep the existing "invalidate on completion" behavior as the final refresh.

**Scope:** renderer-only. No backend, schema, or measurement change. Each run already persists immediately, so the data is already there to show.

### Component 2 — Completion notification

**Change:** When `runLoop` finishes (in the `finally`/after-success path in `batch.ts`), fire a native Electron `Notification` from the main process: title e.g. `Benchmark done`, body e.g. `${done} runs · ${failed} failed`. Wrap in try/catch and guard `Notification.isSupported()`.

**Keep:** the existing in-app Sonner toast (fired from the renderer when `progress.running` flips false) as an in-app dupe.

**Scope:** main process + tiny renderer (toast already exists).

### Component 3 — Transient retry sweep

**Where:** new step in `runLoop`, after the `tasks×reps` loop, before analysis.

**Logic:**
1. Select this batch's `benchmarkRuns` rows where `success = false` AND `failReason ∈ {timeout, sdk_error}`.
2. For each, re-run the corresponding task once (`runBenchmarkTask(task, { model, repoRoot })`).
3. **Replace** the existing row by `id` (update in place) so `k` stays clean — no extra rows.
4. Recompute `progress.failed` after the sweep.

**Note:** transient runs already got one inline retry during the main loop; this sweep is a *second, final* attempt. One pass, one attempt per failed run.

**Progress phase:** extend `Progress` with `phase?: 'running' | 'retrying' | 'analyzing' | 'done'` so the UI can label the current stage. Set `'retrying'` during the sweep, `'analyzing'` during analysis, `'done'` at the end.

### Component 4 — Auto-analysis (A/B, 2-3 sentences)

**Shared A/B helper (new, pure):** extract the grouping/median/delta logic currently inside the `results` tRPC procedure into a pure function (e.g. `src/main/services/benchmark/aggregate.ts`) that takes raw rows and returns the per-task A/B comparison (this batch's infra variant vs the previous baseline variant). Both the `results` query and the analyzer call it. This makes the aggregation unit-testable and keeps a single source of truth.

**Analysis call:** after the retry sweep, run a **one-shot** (single-turn, non-streaming) Claude SDK call following the `runner.ts` pattern (`bypassPermissions`, `subscriptionEnv()`, **no tools**). Input: the A/B slice (this batch's medians vs previous baseline infra variant) rendered as text via a pure prompt-builder. Output: 2-3 plain-language sentences focused on the **A/B effect of the infra change** (faster/cheaper/regressed, and where).

**Model:** the batch's `model`.

**Persistence — new table `benchmarkAnalysis`:**

| Column | Type | Notes |
|---|---|---|
| `id` | text (pk) | UUID |
| `batchId` | text | batch this analysis summarizes |
| `createdAt` | int (ts_ms) | |
| `model` | text | model used for the batch |
| `infraHash` | text | infra under test |
| `baselineInfraHash` | text? | the compared baseline variant (nullable if no baseline) |
| `summary` | text? | 2-3 sentences; null if analysis failed |
| `dataJson` | text (json) | the A/B slice the summary was based on; also seeds the chat |

UI fetches the **latest** row by `createdAt` → behaves as "replaced each batch." History rows are retained in the table (cheap); `wipeRuns` should also clear `benchmarkAnalysis`.

**New tRPC procedures (benchmark router):**
- `latestAnalysis` (query) → newest `benchmarkAnalysis` row or null.
- (optional) `reanalyze` (mutation, `{ batchId }`) → re-run the one-shot for an existing batch (used by the "analysis unavailable" retry button).

### Component 5 — Discuss chat

Reuse the skill-improver streaming pattern end-to-end.

**Backend:**
- New service `src/main/services/benchmarkChat/` — mailbox (copy of `skillImprover/mailbox.ts`) + a `startBenchmarkChat` driver running `query()` in streaming-input mode. Tools: **read-only** (`Read`, `Grep`, `Glob`), `cwd = repoRoot`, `bypassPermissions`, `subscriptionEnv()`.
- **Seed context (pure builder):** the analysis `summary` + the `dataJson` A/B table rendered as text, given as the opening context so the model can answer follow-ups about the conclusion and dig into the repo/transcripts.
- New router `src/main/trpc/routers/benchmarkChat.ts` — `.start` (subscription, streams the same event shape as improver: `token`/`tool`/`awaiting-input`/`done`/`error`/`aborted`), `.reply` (mutation, push user text into mailbox), `.cancel`. In-memory `Map<requestId, Run>`.

**Frontend:**
- Store `src/renderer/src/store/benchmarkChatRun.ts` — mirror `skillImproverRun.ts` (transcript, streaming, status, awaitingInput), minus the improver-specific `report`/`skillId` fields.
- App-level host `src/renderer/src/components/BenchmarkChatHost.tsx` — mirror `SkillImproverHost.tsx`; subscribes to `benchmarkChat.start`, dispatches events to the store. Mounted at App level so it survives benchmark-tab switches (`concepts/subscription-lifecycle-tab-persistence`).
- Overlay component — mirror `ImproverOverlay` (transcript + textarea + Send/Stop), minus accept/reject.
- A **"Discuss"** button on the analysis card spawns the session (passes the latest analysis `batchId`/context).

## Data Flow

```
run
 └─ runLoop:
     ├─ for task × rep: runBenchmarkTask (inline transient retry) → insert benchmarkRuns row (LIVE)
     │     (UI polls `results` every 2s → table fills in)
     ├─ phase=retrying: re-run transient failures once → REPLACE rows → recompute failed
     ├─ phase=analyzing: aggregate A/B (shared helper) → one-shot SDK → insert benchmarkAnalysis
     └─ phase=done, running=false
          ├─ main: native Notification
          └─ UI: toast + analysis card (summary + "Discuss")
                    └─ click → benchmarkChat.start (seeded: summary + dataJson, read-only tools)
                                 → streams into overlay; user .reply / .cancel
```

## Error Handling

- **Analysis failure** (SDK error/timeout): write the `benchmarkAnalysis` row with `summary = null`; do NOT mark the batch `error`ed (separate try/catch around the analysis step). UI card shows "analysis unavailable" + a retry button (`reanalyze`).
- **Retry sweep** doesn't help: the row stays `success = false` (already recorded); no further attempts.
- **Chat errors**: surfaced in the overlay via an `error` event (same as improver).
- **Notification**: guarded by `Notification.isSupported()` + try/catch.

## Testing

Pure, unit-testable seams (the heavy SDK/IO stays at the edges):
- A/B aggregation helper (`aggregate.ts`): grouping by `(taskId, infraHash, model)`, medians, deltas vs baseline.
- Retry-sweep selection predicate: only `{timeout, sdk_error}` selected; `assertion_failed`/`rate_limited` excluded.
- Analysis prompt-builder: given an A/B slice → expected prompt text.
- Chat seed-context builder: given summary + dataJson → expected seed text.
- `runLoop` with an injected fake `runBenchmarkTask` (requires threading `runBenchmarkTask` as an injectable dependency for testability): asserts the sweep re-runs only transient failures and replaces rows rather than appending.

## Implementation Phasing

- **Phase A** — live results (renderer) + native notification (main) + transient retry sweep + `Progress.phase`.
- **Phase B** — shared A/B helper + `benchmarkAnalysis` table + one-shot analysis + `latestAnalysis`/`reanalyze` + analysis card UI.
- **Phase C** — discuss chat (service + router + store + App-host + overlay + "Discuss" button).

## Open Decisions Resolved

- Retry sweep: **transient only** (`timeout`/`sdk_error`), replace row in place.
- Analysis focus: **A/B effect of the infra change** vs previous baseline variant.
- Analysis lifecycle: **one-shot at batch end**, persisted, fetched as latest.
- Chat capabilities: **read-only repo/transcript tools** (Read/Grep/Glob) + seeded analysis & A/B data.
- Chat surface: **reuse improver streaming pattern**, App-level host.
