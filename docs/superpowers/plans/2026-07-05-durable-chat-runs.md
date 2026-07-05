# Durable Chat Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chat runs (especially the full-access worker) survive Mac sleep, app restart, and subscription-limit rejections by auto-continuing the interrupted work, and surface live subscription usage as a dashboard gauge.

**Architecture:** A chat run gains an *intent* ("keep working") in the main-process `ChatSessionRegistry` that outlives any single SDK `query()`. On an unexpected stop (error / stall / rate-limit-rejected — anything that is not a clean `awaiting-input` or a user cancel), the registry rebuilds the run with `resume:true` and seeds the mailbox with a continuation prompt, so the SDK loads the on-disk transcript *and* processes a fresh "keep going" turn. A per-session loop-guard caps consecutive no-progress retries. The SDK's own `rate_limit_event` (authoritative `utilization` + `resetsAt`) drives both the reset-timed auto-continue and a new dashboard usage gauge.

**Tech Stack:** Electron main (Node), `@anthropic-ai/claude-agent-sdk`, tRPC + observables, zustand (renderer), React, Vitest, Biome.

## Global Constraints

- All UI strings and agent prompts are **English only** (generated digest content may be Russian; not applicable here).
- Lint/format is **Biome** (`pnpm lint`); typecheck is `pnpm typecheck`; tests are `pnpm test` (Vitest, `vitest run`). All three run in the pre-commit hook — a commit fails if any fails.
- Do **not** introduce new `any` (Biome `noExplicitAny` is a warning here but avoid adding more).
- "Continuing the work" is a **re-issued turn via `query({resume})` + a seeded continuation prompt**, never a literal process thaw.
- No new npm dependencies.
- The SDK is imported via `await import('@anthropic-ai/claude-agent-sdk')` in `resumableRun.ts` — keep it dynamically imported so tests can run without spawning it.
- Auth uses the Claude subscription via `subscriptionEnv()` — never add an API key.

---

## File Structure

**Phase A — durability core (ships the critical fix on its own):**
- `src/main/services/chat/stopClassifier.ts` **(create)** — pure helpers: `classifyStop`, `nextAutoContinueDelayMs`, `continuationPrompt`, loop-guard math.
- `src/shared/ipc-events.ts` **(modify)** — add `reconnecting` / `rate-limit` / `limited` / `resuming` to `BaseChatEvent`.
- `src/main/services/chat/resumableRun.ts` **(modify)** — handle `api_retry` / `rate_limit_event`; add `resumeMessage` option; add stall watchdog; push a terminal signal on unexpected loop-end.
- `src/main/services/chat/registry.ts` **(modify)** — run intent, auto-continue, loop-guard, rate-limit-timed resume, `continueWork` param.
- `src/main/services/chat/subscriptionUsage.ts` **(create)** — main-side singleton caching last-known `rate_limit_info` (snapshot + onChange), fed by `resumableRun`.
- `src/main/index.ts` (or the main entry that calls `initStore`) **(modify)** — `powerMonitor.on('resume')` nudge.
- `src/renderer/src/store/createChatRunStore.ts` **(modify)** — add `reconnecting` / `limited` statuses + setters.
- `src/renderer/src/components/ChatHost.tsx` **(modify)** — handle new events; send `continueWork` on reattach.
- The four chat routers **(modify)** — add optional `continueWork` to each `open` input and forward it: `workerChat.ts`, `generalChat.ts`, `roadmapChat.ts`, `benchmarkChat.ts`.

**Phase B — subscription gauge:**
- `src/main/trpc/routers/subscriptionUsage.ts` **(create)** — `get` query + `watch` subscription.
- `src/main/trpc/router.ts` **(modify)** — register `subscriptionUsage`.
- `src/renderer/src/pages/Settings.tsx` **(modify)** — "Claude Subscription" plan picker.
- `src/renderer/src/components/dashboard/SubscriptionWidget.tsx` **(create)** — usage gauge (reuse the worker's arc/countdown/pulse visuals).
- `src/renderer/src/pages/Dashboard.tsx` **(modify)** — mount `<SubscriptionWidget />` on `.dash-rail`.
- `src/renderer/src/index.css` **(modify)** — gauge SVG styles + `pulse-glow` keyframe.

---

# PHASE A — Durability core

## Task A1: Pure stop-classifier + continuation helpers

**Files:**
- Create: `src/main/services/chat/stopClassifier.ts`
- Test: `src/main/services/chat/stopClassifier.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type StopKind = 'clean' | 'unexpected' | 'rate-limited'`
  - `classifyStop(event: { type: string; status?: string }, userCancelled: boolean): StopKind`
  - `nextAutoContinueDelayMs(input: { resetsAt?: number; now: number; attempt: number }): number`
  - `shouldStopAutoContinue(noProgressCount: number, cap?: number): boolean`
  - `continuationPrompt(kind: 'worker' | 'plain'): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/chat/stopClassifier.test.ts
import { describe, expect, it } from 'vitest'
import {
  classifyStop,
  continuationPrompt,
  nextAutoContinueDelayMs,
  shouldStopAutoContinue,
} from './stopClassifier'

describe('classifyStop', () => {
  it('treats awaiting-input as clean', () => {
    expect(classifyStop({ type: 'awaiting-input' }, false)).toBe('clean')
  })
  it('treats a user-cancelled abort as clean', () => {
    expect(classifyStop({ type: 'aborted' }, true)).toBe('clean')
  })
  it('treats a non-user abort as unexpected', () => {
    expect(classifyStop({ type: 'aborted' }, false)).toBe('unexpected')
  })
  it('treats an error as unexpected', () => {
    expect(classifyStop({ type: 'error' }, false)).toBe('unexpected')
  })
  it('treats a rejected rate-limit as rate-limited', () => {
    expect(classifyStop({ type: 'rate-limit', status: 'rejected' }, false)).toBe('rate-limited')
  })
  it('treats an allowed rate-limit as clean (informational)', () => {
    expect(classifyStop({ type: 'rate-limit', status: 'allowed' }, false)).toBe('clean')
  })
  it('treats token/tool activity as clean (not a stop)', () => {
    expect(classifyStop({ type: 'token' }, false)).toBe('clean')
  })
})

describe('nextAutoContinueDelayMs', () => {
  it('waits until resetsAt when it is in the future', () => {
    expect(nextAutoContinueDelayMs({ resetsAt: 10_000, now: 4_000, attempt: 0 })).toBe(6_000)
  })
  it('returns a small floor when resetsAt is already past', () => {
    expect(nextAutoContinueDelayMs({ resetsAt: 1_000, now: 5_000, attempt: 0 })).toBe(1_000)
  })
  it('backs off exponentially when resetsAt is missing', () => {
    expect(nextAutoContinueDelayMs({ now: 0, attempt: 0 })).toBe(1_000)
    expect(nextAutoContinueDelayMs({ now: 0, attempt: 1 })).toBe(2_000)
    expect(nextAutoContinueDelayMs({ now: 0, attempt: 3 })).toBe(8_000)
  })
  it('caps the backoff at 60s', () => {
    expect(nextAutoContinueDelayMs({ now: 0, attempt: 20 })).toBe(60_000)
  })
})

describe('shouldStopAutoContinue', () => {
  it('allows retries below the cap', () => {
    expect(shouldStopAutoContinue(2)).toBe(false)
  })
  it('stops at the cap (default 3)', () => {
    expect(shouldStopAutoContinue(3)).toBe(true)
  })
  it('honours a custom cap', () => {
    expect(shouldStopAutoContinue(1, 1)).toBe(true)
  })
})

describe('continuationPrompt', () => {
  it('mentions git for the worker variant', () => {
    expect(continuationPrompt('worker').toLowerCase()).toContain('git')
  })
  it('is English and non-empty for the plain variant', () => {
    expect(continuationPrompt('plain').length).toBeGreaterThan(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/chat/stopClassifier.test.ts`
Expected: FAIL — "Cannot find module './stopClassifier'".

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/services/chat/stopClassifier.ts

// Pure decision helpers for the durable-run controller. No SDK / IO here so the
// registry's auto-continue policy is unit-testable in isolation.

export type StopKind = 'clean' | 'unexpected' | 'rate-limited'

const AUTO_CONTINUE_CAP = 3
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 60_000
const RESET_FLOOR_MS = 1_000

// Classify a run event as a stop signal. `clean` = a normal pause (awaiting the
// user) or a user-initiated cancel; `rate-limited` = the SDK rejected us and we
// must wait for the window to reset; `unexpected` = an error / stall / non-user
// abort that we should auto-continue. Anything that is not a stop is `clean`.
export function classifyStop(
  event: { type: string; status?: string },
  userCancelled: boolean,
): StopKind {
  if (event.type === 'rate-limit') {
    return event.status === 'rejected' ? 'rate-limited' : 'clean'
  }
  if (event.type === 'error') return 'unexpected'
  if (event.type === 'aborted') return userCancelled ? 'clean' : 'unexpected'
  return 'clean'
}

// How long to wait before the next auto-continue. Prefer the SDK-reported
// resetsAt (epoch ms); if absent, exponential backoff capped at 60s.
export function nextAutoContinueDelayMs(input: {
  resetsAt?: number
  now: number
  attempt: number
}): number {
  if (typeof input.resetsAt === 'number') {
    return Math.max(RESET_FLOOR_MS, input.resetsAt - input.now)
  }
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** input.attempt)
}

// Stop auto-continuing once we have retried `cap` times without any new
// assistant/tool activity — guards against an agent that instantly re-errors.
export function shouldStopAutoContinue(noProgressCount: number, cap = AUTO_CONTINUE_CAP): boolean {
  return noProgressCount >= cap
}

// The synthetic user message seeded into the mailbox on auto-continue.
export function continuationPrompt(kind: 'worker' | 'plain'): string {
  if (kind === 'worker') {
    return [
      'The previous turn was interrupted (app restart, sleep, or a rate limit).',
      'Continue the task you were working on. First re-check the current repo',
      'state (`git status` / `git diff`) to see what you already changed, then',
      'pick up exactly where you left off. Do not repeat work already done and',
      'do not start over. English only.',
    ].join(' ')
  }
  return [
    'The previous turn was interrupted. Continue where you left off and finish',
    'the task you were working on, without repeating work already done.',
  ].join(' ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/chat/stopClassifier.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/chat/stopClassifier.ts src/main/services/chat/stopClassifier.test.ts
git commit -m "feat(chat): pure stop-classifier + continuation helpers for durable runs"
```

---

## Task A2: New chat events + resumableRun SDK handling

**Files:**
- Modify: `src/shared/ipc-events.ts`
- Modify: `src/main/services/chat/resumableRun.ts`

**Interfaces:**
- Consumes: nothing new (SDK message types already ship in `@anthropic-ai/claude-agent-sdk`).
- Produces:
  - `BaseChatEvent` additionally includes:
    - `{ type: 'reconnecting'; attempt: number; maxRetries: number; delayMs: number }`
    - `{ type: 'rate-limit'; status: 'allowed' | 'allowed_warning' | 'rejected'; utilization?: number; resetsAt?: number; rateLimitType?: string }`
    - `{ type: 'limited'; resetsAt?: number; rateLimitType?: string; resumesInMs?: number }`
    - `{ type: 'resuming'; attempt: number }`
  - `StartResumableChatOptions` gains `resumeMessage?: string` and `onRateLimit?: (info: RateLimitInfo) => void`, where `RateLimitInfo = { status; utilization?; resetsAt?; rateLimitType? }`.
  - When resuming with a `resumeMessage`, the mailbox is seeded with it (turn is issued); resuming with no `resumeMessage` idles as today.

- [ ] **Step 1: Add the new events to `ipc-events.ts`**

Modify the `BaseChatEvent` union (top of `src/shared/ipc-events.ts`):

```ts
// Common events shared by every drawer chat's transport layer.
export type BaseChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; summary: string; toolId: string }
  | { type: 'tool-result'; toolId: string; resultText: string; isError: boolean }
  | { type: 'awaiting-input' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
  // Durability signals (see docs/superpowers/specs/2026-07-05-durable-chat-runs-design.md):
  // the SDK is auto-retrying a dropped API connection (e.g. after sleep).
  | { type: 'reconnecting'; attempt: number; maxRetries: number; delayMs: number }
  // Live subscription rate-limit info; feeds the usage gauge and limit handling.
  | {
      type: 'rate-limit'
      status: 'allowed' | 'allowed_warning' | 'rejected'
      utilization?: number
      resetsAt?: number
      rateLimitType?: string
    }
  // The run is paused until the subscription window resets, then auto-continues.
  | { type: 'limited'; resetsAt?: number; rateLimitType?: string; resumesInMs?: number }
  // An interrupted run is being auto-continued via resume + a continuation turn.
  | { type: 'resuming'; attempt: number }
```

- [ ] **Step 2: Add `RateLimitInfo` shared type in `ipc-events.ts`**

Append near the `BaseChatEvent` definition:

```ts
// Last-known subscription rate-limit snapshot cached in main + shown in the gauge.
export interface RateLimitInfo {
  status: 'allowed' | 'allowed_warning' | 'rejected'
  utilization?: number
  resetsAt?: number
  rateLimitType?: string
}
```

- [ ] **Step 3: Handle `api_retry` + `rate_limit_event` and add `resumeMessage` in `resumableRun.ts`**

In `src/main/services/chat/resumableRun.ts`:

3a. Extend the options interface (add two fields to `StartResumableChatOptions`):

```ts
  resume: boolean
  // Seeded into the mailbox when resume === true so the SDK, after loading the
  // on-disk transcript, immediately processes a continuation turn instead of
  // idling. Undefined on a plain reattach (idle) or a fresh session.
  resumeMessage?: string
  emit: (event: BaseChatEvent) => void
  // Called on every SDK rate_limit_event so the caller can cache account usage.
  onRateLimit?: (info: {
    status: 'allowed' | 'allowed_warning' | 'rejected'
    utilization?: number
    resetsAt?: number
    rateLimitType?: string
  }) => void
```

3b. Change the mailbox seeding line inside the `done` async body:

```ts
    mailbox = createMailbox(opts.resume ? opts.resumeMessage : opts.seed)
```

3c. Inside the `for await (const message of q ...)` loop, add two new branches. Place them alongside the existing `message.type === 'stream_event'` etc. branches (before the `else if (message.type === 'result')` branch):

```ts
      } else if (message.type === 'system' && message.subtype === 'api_retry') {
        // The SDK hit a retryable API error (incl. connection timeouts after
        // sleep, error_status === null) and will retry after a delay. Surface it
        // so the UI shows "reconnecting" instead of a silent hang.
        opts.emit({
          type: 'reconnecting',
          attempt: message.attempt,
          maxRetries: message.max_retries,
          delayMs: message.retry_delay_ms,
        })
      } else if (message.type === 'rate_limit_event') {
        const info = message.rate_limit_info
        opts.onRateLimit?.({
          status: info.status,
          utilization: info.utilization,
          resetsAt: info.resetsAt,
          rateLimitType: info.rateLimitType,
        })
        opts.emit({
          type: 'rate-limit',
          status: info.status,
          utilization: info.utilization,
          resetsAt: info.resetsAt,
          rateLimitType: info.rateLimitType,
        })
```

- [ ] **Step 4: Push a terminal signal when the stream ends without a clean result, and add the stall watchdog**

4a. Add a watchdog + a "loop ended unexpectedly" emission. Replace the run's IIFE tail and the `for await` completion so that: (a) a 90s inactivity timer fires an error+abort while a turn is active; (b) if the loop falls through without the run being stopped, an `error` is emitted so the registry can auto-continue.

Add near the top of `startResumableChat`, after `let accumulated = ''`:

```ts
  const STALL_MS = 90_000
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let idle = false // true between a clean awaiting-input and the next activity
  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = null
  }
  const armWatchdog = () => {
    clearWatchdog()
    if (stopped || idle) return
    watchdog = setTimeout(() => {
      if (stopped || idle) return
      // No SDK activity for STALL_MS while mid-turn — treat as a dead stream.
      opts.emit({ type: 'error', message: 'Run stalled — reconnecting' })
      controller.abort()
      queryRef?.interrupt().catch(() => {})
    }, STALL_MS)
  }
```

4b. Call `armWatchdog()` at the very start of each `for await` iteration body, and set `idle` appropriately: set `idle = false` at the top of the loop body; when emitting `awaiting-input` (in the `result` success branch) set `idle = true` and `clearWatchdog()`. Concretely, inside the loop add as the first statements:

```ts
      idle = false
      armWatchdog()
```

And in the existing `result` success branch, after `opts.emit({ type: 'awaiting-input' })` add:

```ts
        idle = true
        clearWatchdog()
```

4c. After the `for await` loop closes (i.e. the stream ended), if the run was not stopped and not idle, emit an error so the registry auto-continues. Add right after the loop, still inside the async IIFE:

```ts
    clearWatchdog()
    if (!stopped && !idle) {
      opts.emit({ type: 'error', message: 'Chat stream ended unexpectedly' })
    }
```

4d. In `cancel()`, call `clearWatchdog()` before `controller.abort()`.

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: PASS. (No unit test here — behavior is exercised by Task A3's registry test with a fake run and by manual smoke.)

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc-events.ts src/main/services/chat/resumableRun.ts
git commit -m "feat(chat): handle api_retry/rate_limit_event, resumeMessage seeding, stall watchdog"
```

---

## Task A3: Registry auto-continue + intent + loop-guard

**Files:**
- Modify: `src/main/services/chat/registry.ts`
- Test: `src/main/services/chat/registry.test.ts` (create)

**Interfaces:**
- Consumes: `classifyStop`, `nextAutoContinueDelayMs`, `shouldStopAutoContinue`, `continuationPrompt` (Task A1); `BaseChatEvent`, `RateLimitInfo` (Task A2).
- Produces:
  - `OpenParams` gains `continueWork?: boolean` and `continuationKind: 'worker' | 'plain'`.
  - `OpenParams.buildRun` signature gains `resumeMessage?: string`:
    `buildRun(args: { resume: boolean; kickoff?: string; resumeMessage?: string; push: (event: unknown) => void }): ResumableRun`
  - Registry behavior: on a `clean` stop → finalize/idle as today; on `unexpected`/`rate-limited` → auto-continue (rebuild run with `resume:true` + continuation) unless the loop-guard cap is hit, in which case emit the terminal `error`.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/chat/registry.test.ts
import { describe, expect, it, vi } from 'vitest'
import { ChatSessionRegistry } from './registry'
import type { ResumableRun } from './resumableRun'

// A fake run whose push() we drive manually. buildRun records how many times it
// was (re)built and with what args.
function fakeRunFactory() {
  const builds: Array<{ resume: boolean; resumeMessage?: string }> = []
  let lastPush: ((e: unknown) => void) | null = null
  const buildRun = vi.fn((args: {
    resume: boolean
    kickoff?: string
    resumeMessage?: string
    push: (e: unknown) => void
  }): ResumableRun => {
    builds.push({ resume: args.resume, resumeMessage: args.resumeMessage })
    lastPush = args.push
    return { reply: vi.fn(), cancel: vi.fn(), done: Promise.resolve() }
  })
  return { builds, buildRun, push: (e: unknown) => lastPush?.(e) }
}

describe('ChatSessionRegistry auto-continue', () => {
  it('rebuilds the run with a continuation on an unexpected stop while working', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    reg.open(
      {
        sessionId: 's1',
        lastSeq: 0,
        kickoff: 'do the thing',
        resumable: true,
        continuationKind: 'worker',
        buildRun: f.buildRun,
      },
      () => {},
    )
    // Simulate work then an unexpected error.
    f.push({ type: 'tool', name: 'Bash', summary: 'git status', toolId: 't1' })
    f.push({ type: 'error', message: 'Chat stream ended unexpectedly' })
    expect(f.builds.length).toBe(2)
    expect(f.builds[1].resume).toBe(true)
    expect(f.builds[1].resumeMessage).toContain('git')
  })

  it('stops after the loop-guard cap of consecutive no-progress retries', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    const events: unknown[] = []
    reg.open(
      {
        sessionId: 's2',
        lastSeq: 0,
        kickoff: 'go',
        resumable: true,
        continuationKind: 'plain',
        buildRun: f.buildRun,
      },
      (env) => events.push(env.event),
    )
    // Three errors with no progress in between → 3rd should give up (terminal error).
    f.push({ type: 'error', message: 'boom' }) // build #2
    f.push({ type: 'error', message: 'boom' }) // build #3
    f.push({ type: 'error', message: 'boom' }) // cap reached → terminal, no build #4
    expect(f.builds.length).toBe(3)
    expect(events.some((e) => (e as { type: string }).type === 'error')).toBe(true)
  })

  it('treats awaiting-input as a clean pause (no rebuild)', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    reg.open(
      {
        sessionId: 's3',
        lastSeq: 0,
        kickoff: 'go',
        resumable: true,
        continuationKind: 'plain',
        buildRun: f.buildRun,
      },
      () => {},
    )
    f.push({ type: 'awaiting-input' })
    expect(f.builds.length).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/chat/registry.test.ts`
Expected: FAIL — `buildRun` is called only once (no auto-continue logic yet) and `continuationKind` is not an accepted param.

- [ ] **Step 3: Implement the registry changes**

Rewrite `src/main/services/chat/registry.ts` as follows (this supersedes the current file):

```ts
import {
  classifyStop,
  continuationPrompt,
  nextAutoContinueDelayMs,
  shouldStopAutoContinue,
} from './stopClassifier'
import type { RateLimitInfo, SeqEnvelope } from '@shared/ipc-events'
import type { ResumableRun } from './resumableRun'

const BUFFER_CAP = 4000 // envelopes; bounds gap-replay depth, not the on-disk transcript

type Subscriber = (env: SeqEnvelope<unknown>) => void
type Status = 'running' | 'awaiting' | 'limited' | 'done' | 'error'

interface SessionRecord {
  sessionId: string
  run: ResumableRun
  buffer: SeqEnvelope<unknown>[]
  nextSeq: number
  status: Status
  subscriber: Subscriber | null
  // Durable-run state.
  continuationKind: 'worker' | 'plain'
  buildRun: OpenParams['buildRun']
  userCancelled: boolean
  noProgressCount: number // consecutive auto-continues with no new activity
  attempt: number // total auto-continues, for backoff
  lastRateLimit: RateLimitInfo | null
  limitTimer: ReturnType<typeof setTimeout> | null
}

export interface OpenParams {
  sessionId: string
  lastSeq: number
  kickoff?: string
  resumable: boolean
  // On a reattach with no kickoff: if true, auto-continue the interrupted work
  // (persisted status was 'running'); if false/absent, resume-and-idle.
  continueWork?: boolean
  continuationKind: 'worker' | 'plain'
  buildRun: (args: {
    resume: boolean
    kickoff?: string
    resumeMessage?: string
    push: (event: unknown) => void
  }) => ResumableRun
}

function isProgress(event: unknown): boolean {
  const type = (event as { type?: string }).type
  return type === 'token' || type === 'tool' || type === 'tool-result'
}

export class ChatSessionRegistry {
  private records = new Map<string, SessionRecord>()

  open(params: OpenParams, emit: Subscriber): () => void {
    const existing = this.records.get(params.sessionId)
    if (existing) {
      existing.subscriber = emit
      for (const env of existing.buffer) if (env.seq > params.lastSeq) emit(env)
      return () => {
        if (existing.subscriber === emit) existing.subscriber = null
      }
    }

    const resume = params.kickoff === undefined
    if (resume && !params.resumable) {
      emit({ seq: 1, event: { type: 'aborted' } })
      return () => {}
    }

    const record: SessionRecord = {
      sessionId: params.sessionId,
      run: undefined as unknown as ResumableRun,
      buffer: [],
      nextSeq: 1,
      status: 'running',
      subscriber: emit,
      continuationKind: params.continuationKind,
      buildRun: params.buildRun,
      userCancelled: false,
      noProgressCount: 0,
      attempt: 0,
      lastRateLimit: null,
      limitTimer: null,
    }
    this.records.set(params.sessionId, record)

    const push = (event: unknown) => this.handle(record, event)

    // Reattach that should continue work → resume WITH a continuation turn.
    const resumeMessage =
      resume && params.continueWork ? continuationPrompt(record.continuationKind) : undefined

    record.run = params.buildRun({ resume, kickoff: params.kickoff, resumeMessage, push })
    return () => {
      if (record.subscriber === emit) record.subscriber = null
    }
  }

  // Central event handler: buffers + forwards every event, and decides whether a
  // stop should finalize, idle, or auto-continue.
  private handle(record: SessionRecord, event: unknown): void {
    const type = (event as { type?: string }).type

    // Forward the event to the client first (so the UI reflects errors/limits).
    const env: SeqEnvelope<unknown> = { seq: record.nextSeq++, event }
    record.buffer.push(env)
    if (record.buffer.length > BUFFER_CAP) record.buffer.shift()
    record.subscriber?.(env)

    if (isProgress(event)) {
      record.status = 'running'
      record.noProgressCount = 0 // real work happened; reset the guard
      return
    }

    if (type === 'rate-limit') {
      record.lastRateLimit = event as RateLimitInfo
      // 'allowed'/'warning' are informational; only 'rejected' stops the run.
    }

    if (type === 'awaiting-input') {
      record.status = 'awaiting'
      record.noProgressCount = 0
      return
    }

    if (type === 'done') {
      this.finalize(record, env.event)
      return
    }

    const kind = classifyStop(event as { type: string; status?: string }, record.userCancelled)
    if (kind === 'clean') {
      if (type === 'aborted') this.finalize(record, event)
      return
    }

    // unexpected | rate-limited → auto-continue unless the guard is tripped.
    if (shouldStopAutoContinue(record.noProgressCount)) {
      this.subscriberEmit(record, { type: 'error', message: 'Auto-continue gave up after repeated failures' })
      this.finalize(record, { type: 'error', message: 'gave up' })
      return
    }

    const now = Date.now()
    const delayMs =
      kind === 'rate-limited'
        ? nextAutoContinueDelayMs({
            resetsAt: record.lastRateLimit?.resetsAt,
            now,
            attempt: record.attempt,
          })
        : nextAutoContinueDelayMs({ now, attempt: record.attempt })

    if (kind === 'rate-limited') {
      record.status = 'limited'
      this.subscriberEmit(record, {
        type: 'limited',
        resetsAt: record.lastRateLimit?.resetsAt,
        rateLimitType: record.lastRateLimit?.rateLimitType,
        resumesInMs: delayMs,
      })
    }

    if (record.limitTimer) clearTimeout(record.limitTimer)
    record.limitTimer = setTimeout(() => this.autoContinue(record), delayMs)
  }

  private autoContinue(record: SessionRecord): void {
    if (!this.records.has(record.sessionId)) return
    record.attempt += 1
    record.noProgressCount += 1
    record.status = 'running'
    this.subscriberEmit(record, { type: 'resuming', attempt: record.attempt })
    record.run = record.buildRun({
      resume: true,
      resumeMessage: continuationPrompt(record.continuationKind),
      push: (event: unknown) => this.handle(record, event),
    })
  }

  // Emit a registry-synthesized event with its own seq (not from the run).
  private subscriberEmit(record: SessionRecord, event: unknown): void {
    const env: SeqEnvelope<unknown> = { seq: record.nextSeq++, event }
    record.buffer.push(env)
    if (record.buffer.length > BUFFER_CAP) record.buffer.shift()
    record.subscriber?.(env)
  }

  private finalize(record: SessionRecord, _event: unknown): void {
    if (record.limitTimer) clearTimeout(record.limitTimer)
    this.records.delete(record.sessionId)
  }

  reply(sessionId: string, text: string): boolean {
    const record = this.records.get(sessionId)
    record?.run.reply(text)
    return Boolean(record)
  }

  cancel(sessionId: string): boolean {
    const record = this.records.get(sessionId)
    if (record) {
      record.userCancelled = true
      if (record.limitTimer) clearTimeout(record.limitTimer)
    }
    record?.run.cancel()
    this.records.delete(sessionId)
    return Boolean(record)
  }
}

export const chatRegistry = new ChatSessionRegistry()
```

> **Important — the exact `delayMs` + scheduling rule** (make the Step-3 code match this). Unexpected stops fire the first retry with **0ms** (so the unit test, which drives `push()` synchronously, sees the rebuild immediately) and back off on later attempts; rate-limited stops always wait for `resetsAt`. Replace the `delayMs` computation and the `setTimeout` line in `handle()` with:
>
> ```ts
> const delayMs =
>   kind === 'rate-limited'
>     ? nextAutoContinueDelayMs({ resetsAt: record.lastRateLimit?.resetsAt, now, attempt: record.attempt })
>     : record.attempt === 0
>       ? 0
>       : nextAutoContinueDelayMs({ now, attempt: record.attempt })
>
> if (record.limitTimer) clearTimeout(record.limitTimer)
> if (delayMs <= 0) this.autoContinue(record)
> else record.limitTimer = setTimeout(() => this.autoContinue(record), delayMs)
> ```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/chat/registry.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Run typecheck (buildRun signature changed for all callers)**

Run: `pnpm typecheck`
Expected: FAIL in the four chat routers (`workerChat.ts`, `generalChat.ts`, `roadmapChat.ts`, `benchmarkChat.ts`) — they call `open(...)` without `continuationKind` and their `buildRun` lacks `resumeMessage`. Task A4 fixes them.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/chat/registry.ts src/main/services/chat/registry.test.ts
git commit -m "feat(chat): registry auto-continue with intent, loop-guard, rate-limit-timed resume"
```

---

## Task A4: Wire the four chat routers (continuationKind, resumeMessage, continueWork, rate-limit cache)

**Files:**
- Modify: `src/main/trpc/routers/workerChat.ts`
- Modify: `src/main/trpc/routers/generalChat.ts`
- Modify: `src/main/trpc/routers/roadmapChat.ts`
- Modify: `src/main/trpc/routers/benchmarkChat.ts`
- Create: `src/main/services/chat/subscriptionUsage.ts`

**Interfaces:**
- Consumes: `chatRegistry.open` new params (Task A3); `startResumableChat` new options (Task A2).
- Produces:
  - `src/main/services/chat/subscriptionUsage.ts` exports a singleton `subscriptionUsage` with:
    - `update(info: RateLimitInfo): void`
    - `snapshot(): RateLimitInfo | null`
    - `onChange(cb: () => void): () => void`
  - Each chat router's `open` input accepts optional `continueWork: z.boolean().optional()` and forwards it; each `buildRun` accepts `resumeMessage` and passes it to `startResumableChat`; worker uses `continuationKind: 'worker'`, the others `'plain'`.

- [ ] **Step 1: Write the failing test for the usage singleton**

```ts
// src/main/services/chat/subscriptionUsage.test.ts
import { describe, expect, it, vi } from 'vitest'
import { SubscriptionUsage } from './subscriptionUsage'

describe('SubscriptionUsage', () => {
  it('starts empty and stores the latest snapshot', () => {
    const u = new SubscriptionUsage()
    expect(u.snapshot()).toBeNull()
    u.update({ status: 'allowed', utilization: 0.4, resetsAt: 123, rateLimitType: 'five_hour' })
    expect(u.snapshot()).toEqual({
      status: 'allowed',
      utilization: 0.4,
      resetsAt: 123,
      rateLimitType: 'five_hour',
    })
  })
  it('notifies subscribers on update and stops after unsubscribe', () => {
    const u = new SubscriptionUsage()
    const cb = vi.fn()
    const off = u.onChange(cb)
    u.update({ status: 'rejected' })
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    u.update({ status: 'allowed' })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/main/services/chat/subscriptionUsage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the usage singleton**

```ts
// src/main/services/chat/subscriptionUsage.ts
import type { RateLimitInfo } from '@shared/ipc-events'

// Main-side cache of the last-known subscription rate-limit snapshot, fed by any
// chat run's rate_limit_event. Mirrors the jobRegistry snapshot/onChange shape.
export class SubscriptionUsage {
  private current: RateLimitInfo | null = null
  private listeners = new Set<() => void>()

  update(info: RateLimitInfo): void {
    this.current = info
    for (const cb of this.listeners) cb()
  }

  snapshot(): RateLimitInfo | null {
    return this.current
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

export const subscriptionUsage = new SubscriptionUsage()
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/main/services/chat/subscriptionUsage.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `workerChat.ts`**

In `src/main/trpc/routers/workerChat.ts`:

5a. Add the import: `import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'`.

5b. Add `continueWork` to the `open` input schema:

```ts
        sessionId: z.string().uuid(),
        lastSeq: z.number().int().nonnegative(),
        kickoff: z.string().min(1).optional(),
        continueWork: z.boolean().optional(),
```

5c. Pass `continuationKind` + `continueWork` to `chatRegistry.open` and thread `resumeMessage` + `onRateLimit` into `startResumableChat`. The `buildRun` callback signature becomes `({ resume, kickoff, resumeMessage, push })`:

```ts
        return chatRegistry.open(
          {
            sessionId: input.sessionId,
            lastSeq: input.lastSeq,
            kickoff: input.kickoff,
            resumable: true,
            continueWork: input.continueWork,
            continuationKind: 'worker',
            buildRun: ({ resume, kickoff, resumeMessage, push }) => {
              const job = jobRegistry.register({
                kind: 'worker.chat',
                label: 'Worker chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              })
              return startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd: repoRoot,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                seed: kickoff ? buildWorkerChatSeed(kickoff) : undefined,
                resume,
                resumeMessage,
                onRateLimit: (info) => subscriptionUsage.update(info),
                emit: (event) => {
                  if (event.type === 'done') job.finish('done')
                  if (event.type === 'error' || event.type === 'aborted') job.finish('error')
                  push(event)
                },
              })
            },
          },
          (env) => emit.next(env as SeqEnvelope<BaseChatEvent>),
        )
```

- [ ] **Step 6: Apply the same three edits to `generalChat.ts`, `roadmapChat.ts`, `benchmarkChat.ts`**

For each: add the `subscriptionUsage` import, add `continueWork: z.boolean().optional()` to the `open` input, add `continueWork: input.continueWork` and `continuationKind: 'plain'` to `chatRegistry.open`, add `resumeMessage` to the `buildRun` destructure and pass `resumeMessage` + `onRateLimit: (info) => subscriptionUsage.update(info)` to `startResumableChat`. (These routers' seeds differ but the wiring is identical — do not change their existing seed logic.)

- [ ] **Step 7: Verify typecheck + full test suite pass**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/chat/subscriptionUsage.ts src/main/services/chat/subscriptionUsage.test.ts src/main/trpc/routers/workerChat.ts src/main/trpc/routers/generalChat.ts src/main/trpc/routers/roadmapChat.ts src/main/trpc/routers/benchmarkChat.ts
git commit -m "feat(chat): wire routers for continuation + cache subscription usage"
```

---

## Task A5: Renderer — statuses, event handling, continueWork on reattach

**Files:**
- Modify: `src/renderer/src/store/createChatRunStore.ts`
- Modify: `src/renderer/src/components/ChatHost.tsx`

**Interfaces:**
- Consumes: new `BaseChatEvent` variants (Task A2); routers accept `continueWork` (Task A4).
- Produces:
  - `ChatStatus` additionally includes `'reconnecting' | 'limited'`.
  - `BaseChatRunState` gains `setReconnecting(): void`, `setLimited(resumesInMs?: number): void`, `setResuming(): void`.
  - `ChatHost` sends `continueWork: true` in the reattach `open` input when the persisted status was `running`.

- [ ] **Step 1: Add statuses + setters to the store**

In `src/renderer/src/store/createChatRunStore.ts`:

1a. Extend `ChatStatus`:

```ts
export type ChatStatus =
  | 'idle'
  | 'running'
  | 'awaiting'
  | 'reconnecting'
  | 'limited'
  | 'done'
  | 'error'
  | 'aborted'
```

1b. Add setter signatures to `BaseChatRunState` (near `setAwaiting`):

```ts
  setReconnecting: () => void
  setLimited: (resumesInMs?: number) => void
  setResuming: () => void
```

1c. Add the implementations (near `setAwaiting`):

```ts
        setReconnecting: () => set({ status: 'reconnecting', awaitingInput: false, running: true }),
        setLimited: () => set({ status: 'limited', awaitingInput: false, running: true }),
        setResuming: () => set({ status: 'running', awaitingInput: false, running: true }),
```

1d. Include `'reconnecting'` and `'limited'` in the persisted statuses so a reattach after restart is recognized. In `partialize` nothing changes (status already persisted), but confirm `reattach` eligibility in ChatHost (Step 2) treats them like `running`.

- [ ] **Step 2: Handle the new events + send continueWork in ChatHost**

In `src/renderer/src/components/ChatHost.tsx`:

2a. Broaden the reattach-on-mount condition to include the new "in-flight" statuses:

```ts
    if (
      s.sessionId &&
      (s.status === 'running' ||
        s.status === 'awaiting' ||
        s.status === 'reconnecting' ||
        s.status === 'limited') &&
      !s.running
    ) {
      s.reattach()
    }
```

2b. In `subInput`, send `continueWork` when the persisted status indicates interrupted work (anything other than a clean `awaiting`):

```ts
  const subInput = useMemo<OpenInput | typeof skipToken>(() => {
    if (!running || !sessionId) return skipToken
    const s = useRun.getState()
    const isFreshStart = s.status === 'running' && s.lastSeq === 0
    // A reattach whose last persisted status was mid-work should auto-continue.
    const continueWork = !isFreshStart && s.status !== 'awaiting'
    return {
      sessionId,
      lastSeq: s.lastSeq,
      kickoff: isFreshStart ? kickoff : undefined,
      continueWork,
    }
  }, [running, sessionId, kickoff, useRun])
```

2c. Extend `OpenInput` to include `continueWork?: boolean` (top of the file):

```ts
interface OpenInput {
  sessionId: string
  lastSeq: number
  kickoff?: string
  continueWork?: boolean
}
```

2d. Handle the new event types in the `onData` switch (add cases before `default`/closing):

```ts
        case 'reconnecting':
          store.setReconnecting()
          break
        case 'rate-limit':
          // Account-level info is cached in main for the gauge; nothing to do
          // in the per-chat store beyond ignoring the informational event.
          break
        case 'limited':
          store.flushTurn()
          store.setLimited(
            (event as { resumesInMs?: number }).resumesInMs,
          )
          break
        case 'resuming':
          store.setResuming()
          break
```

- [ ] **Step 3: Verify typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/createChatRunStore.ts src/renderer/src/components/ChatHost.tsx
git commit -m "feat(chat): renderer statuses + continueWork reattach + durability events"
```

---

## Task A6: powerMonitor wake nudge

**Files:**
- Modify: `src/main/index.ts` (the main entry that calls `initStore()`; confirm with `grep -rn "initStore()" src/main`)

**Interfaces:**
- Consumes: `chatRegistry` (exported singleton). Note the registry's own stall watchdog (Task A2/A4) already auto-continues stalled runs; this task makes wake-up *prompt* rather than waiting up to 90s.

- [ ] **Step 1: Add a `nudgeStalled()` method to the registry**

In `src/main/services/chat/registry.ts`, add a public method that force-triggers an auto-continue for any record currently in `running` (mid-work) state — used on system resume:

```ts
  // Called on OS wake: a run that was mid-turn when the machine slept may have a
  // dead stream that has not yet tripped the 90s watchdog. Cancel its current
  // query and auto-continue immediately.
  nudgeStalled(): void {
    for (const record of this.records.values()) {
      if (record.status === 'running') {
        record.run.cancel()
        this.autoContinue(record)
      }
    }
  }
```

- [ ] **Step 2: Wire `powerMonitor` in the main entry**

In `src/main/index.ts`, add the import and, inside the `app.whenReady()` / post-`initStore()` block, register:

```ts
import { powerMonitor } from 'electron'
import { chatRegistry } from '@main/services/chat/registry'

// After the machine wakes, re-establish any chat run whose stream died during
// sleep instead of waiting for the per-run stall watchdog.
powerMonitor.on('resume', () => chatRegistry.nudgeStalled())
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/services/chat/registry.ts src/main/index.ts
git commit -m "feat(chat): auto-continue stalled runs on system wake (powerMonitor)"
```

- [ ] **Step 5: Manual smoke — Phase A**

Run: `pnpm dev`. Start a worker chat on a multi-step task. Then, in three separate runs:
1. **Restart:** quit the app mid-turn, relaunch → the chat reattaches and a `resuming` turn fires; the agent re-checks git and continues. Expected: no infinite spinner.
2. **Sleep:** `sudo pmset sleepnow` mid-turn; wake → a `reconnecting` chip appears (or the wake nudge fires) then the turn continues.
3. **Loop guard:** give the worker an impossible task that errors immediately → after 3 no-progress retries it stops with the "gave up" error, not an infinite loop.

---

# PHASE B — Subscription usage gauge

## Task B1: subscriptionUsage tRPC router

**Files:**
- Create: `src/main/trpc/routers/subscriptionUsage.ts`
- Modify: `src/main/trpc/router.ts`

**Interfaces:**
- Consumes: `subscriptionUsage` singleton (Task A4); `getSettings` (`@main/store`); `subscriptionLimitTokens` + `SubscriptionPlan` (`@shared/settings`).
- Produces: `subscriptionUsage` router with:
  - `get` query → `{ info: RateLimitInfo | null; plan: SubscriptionPlan; fallbackLimitTokens: number }`
  - `watch` subscription → emits the same object on subscribe and on every `onChange`.

- [ ] **Step 1: Implement the router**

```ts
// src/main/trpc/routers/subscriptionUsage.ts
import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { RateLimitInfo } from '@shared/ipc-events'
import { subscriptionLimitTokens } from '@shared/settings'
import { observable } from '@trpc/server/observable'

interface UsageSnapshot {
  info: RateLimitInfo | null
  plan: string
  fallbackLimitTokens: number
}

function snapshot(): UsageSnapshot {
  const s = getSettings()
  return {
    info: subscriptionUsage.snapshot(),
    plan: s.subscriptionPlan,
    fallbackLimitTokens: subscriptionLimitTokens(s),
  }
}

export const subscriptionUsageRouter = router({
  get: publicProcedure.query(() => snapshot()),

  watch: publicProcedure.subscription(() =>
    observable<UsageSnapshot>((emit) => {
      emit.next(snapshot())
      return subscriptionUsage.onChange(() => emit.next(snapshot()))
    }),
  ),
})
```

- [ ] **Step 2: Register it in `router.ts`**

Add the import and the router key:

```ts
import { subscriptionUsageRouter } from '@main/trpc/routers/subscriptionUsage'
```

```ts
  workerChat: workerChatRouter,
  subscriptionUsage: subscriptionUsageRouter,
})
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/subscriptionUsage.ts src/main/trpc/router.ts
git commit -m "feat(subscription): tRPC router exposing cached rate-limit usage"
```

---

## Task B2: Settings — "Claude Subscription" plan picker

**Files:**
- Modify: `src/renderer/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `settingsQuery` / the mutation pattern already used for `galaxyEdgeStyle` in this file (see `src/renderer/src/pages/Settings.tsx:138-165`); `SUBSCRIPTION_PLANS`, `SubscriptionPlan` from `@shared/settings`.
- Produces: a new settings section that sets `subscriptionPlan` (and, when `custom`, `subscriptionLimitCustom`).

- [ ] **Step 1: Add the plan picker section**

Following the exact pattern of the existing `galaxyEdgeStyle` control (`Settings.tsx:138-165`) — a `settingsQuery.data?.subscriptionPlan ?? 'pro'` value and a mutation calling `trpc.settings.update` (confirm the mutation name used by the edge-style control and reuse it). Add a `<select>` over `SUBSCRIPTION_PLANS` labelled "subscription plan", and, when the value is `custom`, a number input bound to `subscriptionLimitCustom`. Copy the label text: **"subscription plan"**, options **"Pro / Max 5× / Max 20× / Custom"**, and footer note **"Live usage comes from Claude; the plan just labels the gauge and sets a fallback limit."** (English only.)

- [ ] **Step 2: Verify typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 3: Manual check**

Run `pnpm dev` → Settings → change plan to Max 20× and back; select Custom → the number input appears; values persist across app restart.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Settings.tsx
git commit -m "feat(subscription): settings plan picker"
```

---

## Task B3: SubscriptionWidget gauge + dashboard mount + CSS

**Files:**
- Create: `src/renderer/src/components/dashboard/SubscriptionWidget.tsx`
- Modify: `src/renderer/src/pages/Dashboard.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: `trpc.subscriptionUsage.watch.useSubscription` (Task B1); the dashboard widget markup pattern from `BenchmarkWidget.tsx` (`panel dash-widget` / `panel-head` / `panel-body`); the arc/countdown/pulse visual spec from `docs/superpowers/specs/2026-07-04-subscription-usage-gauge-design.md`.
- Produces: `<SubscriptionWidget />` rendered on the `.dash-rail`.

- [ ] **Step 1: Write the countdown-format helper test**

```ts
// src/renderer/src/components/dashboard/subscriptionWidget.test.ts
import { describe, expect, it } from 'vitest'
import { formatCountdown, gaugeTone } from './subscriptionWidget'

describe('formatCountdown', () => {
  it('formats hours:minutes:seconds', () => {
    expect(formatCountdown(2 * 3600_000 + 14 * 60_000 + 9_000)).toBe('02:14:09')
  })
  it('clamps negatives to zero', () => {
    expect(formatCountdown(-500)).toBe('00:00:00')
  })
})

describe('gaugeTone', () => {
  it('is good below 0.75, warn below 0.9, else bad', () => {
    expect(gaugeTone(0.5, 'allowed')).toBe('good')
    expect(gaugeTone(0.8, 'allowed')).toBe('warn')
    expect(gaugeTone(0.95, 'allowed')).toBe('bad')
  })
  it('is always bad when rejected', () => {
    expect(gaugeTone(0.1, 'rejected')).toBe('bad')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/renderer/src/components/dashboard/subscriptionWidget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper module + component**

Create `src/renderer/src/components/dashboard/subscriptionWidget.ts` (pure helpers):

```ts
// Pure helpers for SubscriptionWidget (kept separate so they are unit-testable).
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export type GaugeTone = 'good' | 'warn' | 'bad'
export function gaugeTone(utilization: number, status: string): GaugeTone {
  if (status === 'rejected') return 'bad'
  if (utilization >= 0.9) return 'bad'
  if (utilization >= 0.75) return 'warn'
  return 'good'
}
```

Create `src/renderer/src/components/dashboard/SubscriptionWidget.tsx`:

```tsx
import { Note } from '@renderer/components/dashboard/dash-utils'
import {
  formatCountdown,
  gaugeTone,
} from '@renderer/components/dashboard/subscriptionWidget'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'
import { useEffect, useState } from 'react'
import type { RateLimitInfo } from '@shared/ipc-events'

export function SubscriptionWidget() {
  const [snap, setSnap] = useState<{ info: RateLimitInfo | null; plan: string } | null>(null)
  trpc.subscriptionUsage.watch.useSubscription(undefined, {
    onData: (d) => setSnap(d),
  })

  // Drive the countdown client-side (1s) from the reset timestamp.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const info = snap?.info ?? null
  const util = info?.utilization ?? 0
  const tone = gaugeTone(util, info?.status ?? 'allowed')
  const remaining = info?.resetsAt ? info.resetsAt - now : null

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="subscription" />
        </span>
        <span className="dash-widget-foot">{snap?.plan ?? ''}</span>
      </div>
      <div className="panel-body">
        {info ? (
          <>
            <div className={`dash-widget-big ${tone === 'good' ? 'good' : tone === 'warn' ? 'amber' : 'bad'}`}>
              {Math.round(util * 100)}%
            </div>
            <div className="dash-widget-sub">
              {info.status === 'rejected' ? 'limit reached' : (info.rateLimitType ?? 'usage')}
            </div>
            <div className="dash-widget-foot">
              {remaining != null ? `resets in ${formatCountdown(remaining)}` : 'window open'}
            </div>
          </>
        ) : (
          <Note>no usage data yet — run a chat.</Note>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run to verify the helper test passes**

Run: `pnpm test src/renderer/src/components/dashboard/subscriptionWidget.test.ts`
Expected: PASS.

- [ ] **Step 5: Mount on the dashboard rail**

In `src/renderer/src/pages/Dashboard.tsx`: add `import { SubscriptionWidget } from '@renderer/components/dashboard/SubscriptionWidget'` and render `<SubscriptionWidget />` inside the `.dash-rail` container (near `<BenchmarkWidget />`, around `Dashboard.tsx:454-462`).

- [ ] **Step 6: Add the high-fill pulse CSS (optional polish)**

In `src/renderer/src/index.css`, add a `pulse-glow` keyframe + a class the widget can use at high fill (reuse the amber drop-shadow from the worker's visual spec). Keep it minimal — the widget already reuses existing `dash-widget*` classes.

```css
@keyframes pulse-glow {
  0%, 100% { filter: drop-shadow(0 0 2px var(--color-amber)); }
  50% { filter: drop-shadow(0 0 8px var(--color-amber)); }
}
```

- [ ] **Step 7: Verify typecheck + lint + tests**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 8: Manual smoke — Phase B**

Run `pnpm dev` → Dashboard shows the subscription widget. Run a worker chat; after the first turn the SDK emits `rate_limit_event`, the widget fills to the reported utilization and shows the reset countdown ticking. Force `custom` plan in Settings and confirm the footer label updates.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/dashboard/SubscriptionWidget.tsx src/renderer/src/components/dashboard/subscriptionWidget.ts src/renderer/src/components/dashboard/subscriptionWidget.test.ts src/renderer/src/pages/Dashboard.tsx src/renderer/src/index.css
git commit -m "feat(subscription): dashboard usage gauge fed by SDK rate-limit info"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** durability core (A1–A6) covers restart/sleep/limit auto-continue + loop-guard + watchdog + powerMonitor; gauge (B1–B3) covers SDK-fed usage + settings + widget. The transient-status chip is delivered via the per-chat store statuses (Task A5) surfaced in the existing chat UI; a dedicated `ProcessesStrip` chip was dropped as YAGNI (the chat already shows its own status).
- **Type consistency:** `buildRun` gains `resumeMessage` consistently in registry (A3) and all routers (A4); `continuationKind`/`continueWork` names match across A3/A4/A5; `RateLimitInfo` is defined once in `ipc-events.ts` (A2) and consumed by A4/B1/B3.
- **rate-limit as informational vs. stop:** `classifyStop` returns `clean` for allowed/warning and `rate-limited` only for `rejected` — the widget still updates on all three via `onRateLimit`/`subscriptionUsage.update`, independent of the stop path.
