# Durable Chat Runs — Design

**Date:** 2026-07-05
**Branch:** `feat/subscription-usage-gauge` (in progress — folds in the unfinished worker branch)
**Status:** Approved design, ready for implementation plan

## Problem

When a chat (especially the full-access **worker** chat) is mid-turn and the
computer sleeps or the app restarts, the run **freezes and never continues**.
Today's "chat resume" only restores the **UI transcript**, not the *work*. There
are three distinct failure modes with one shared root cause.

**Root cause:** `ChatSessionRegistry` (`src/main/services/chat/registry.ts`)
lives **in-memory in the Electron main process**; the agent runs there via the
SDK `query()`. Any single `query()` cannot survive a process death, and on
reattach the current code opens the SDK session with an *empty mailbox*, so the
SDK loads history and **idles** — it never re-issues the interrupted turn.

| Trigger | What happens today |
|---|---|
| **App restart** | Main process dies → agent turn dies. Reattach resumes-and-idles → UI stuck on "running" forever. (This is the currently-hung worker.) |
| **Sleep** | Main survives, but the streaming HTTP connection dies mid-turn. The `for await` loop throws (→ error) or hangs silently (→ "running" forever). |
| **Subscription limit** | SDK returns a non-success result; code emits `{type:'error'}` and stops. No wait-for-reset, no auto-continue (unlike Claude Code). |

## Goals

1. A mid-turn run survives **app restart** and **sleep** and **auto-continues**
   the work (not just the transcript).
2. When a run hits the **subscription limit**, it waits until the limit resets
   and auto-continues — like Claude Code.
3. Fold in the started-but-unfinished **subscription usage gauge** (plan
   settings + a live usage/countdown UI), wired to the same limit data.

### Key constraint / expectation-setting

"Continuing the work" **cannot** literally revive the exact interrupted process.
Like Claude Code's `--resume`, it means **re-issuing a fresh turn against the
saved on-disk transcript with a continuation instruction.** The agent reviews
what it had done and picks up — a new turn, not a frozen-and-thawed one.

## The SDK does the heavy lifting

The `@anthropic-ai/claude-agent-sdk` message stream already surfaces exactly
what we need (verified in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`):

- **`SDKRateLimitEvent`** (`type: 'rate_limit_event'`) → `rate_limit_info: SDKRateLimitInfo` with:
  - `status`: `'allowed' | 'allowed_warning' | 'rejected'`
  - `resetsAt?`: epoch ms — **exact reset time**
  - `rateLimitType?`: `'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'overage'`
  - `utilization?`: 0–1 — **live gauge value**
  - Emitted whenever rate-limit info changes.
- **`SDKAPIRetryMessage`** (`type: 'system', subtype: 'api_retry'`) → `attempt`,
  `max_retries`, `retry_delay_ms`, `error_status` (null for connection timeouts).
  The SDK **already auto-retries dropped connections** (e.g. sleep-induced stream
  death) with backoff — we just surface it instead of hanging.
- **`SDKResultMessage.usage` / `.modelUsage`** → per-turn token counts.

This makes the SDK's `rate_limit_info` the **authoritative** source for both the
gauge and the reset timing — strictly better than the worker's hardcoded
per-plan token guesses, which become display labels / a fallback only.

## Architecture

### Unit 1 — Durable run controller (main)

**What it does:** gives a chat run an *intent* ("keep working") that outlives any
single `query()`, and auto-restarts + re-issues the work on an unexpected stop.

**Where:** extend `src/main/services/chat/registry.ts` and
`src/main/services/chat/resumableRun.ts`. No new persistent store in main
(restart persistence stays renderer-driven, Unit 2).

**Interface / behavior:**

- **Clean stop** = `result: success` → `awaiting-input`, **or** explicit user
  `cancel`. Everything else that ends the loop — thrown error, `result: error`,
  stream end without a success result, rate-limit `rejected` — is an
  **unexpected stop**.
- **Auto-continue** on unexpected stop = start a fresh `query({ resume: sessionId })`
  and **push a continuation prompt into the mailbox** so the SDK issues a real
  turn instead of idling. Emit a `resuming` event first.
  - Continuation prompt (default): *"Continue the task you were working on.
    First re-check the current repo state (e.g. `git status`/`git diff`) to see
    what you already changed, then pick up where you left off. Do not repeat work
    already done. English only."* (Worker variant references git; non-code chats
    get a plainer variant.)
- **Loop guard:** a per-session counter of **consecutive** auto-continues that
  produced **no new tool/assistant activity**. At the cap (default `3`), stop
  with `error` + surface a manual **Resume**. Any real activity resets the
  counter. Manual **Stop** always cancels and clears intent.
- **New SDK message handling in `resumableRun.ts`:**
  - `system/api_retry` → emit `reconnecting { attempt, maxRetries, delayMs, reason }`.
  - `rate_limit_event` → emit `rate-limit { utilization, resetsAt, rateLimitType, status }`;
    if `status === 'rejected'`, mark the run limited (Unit 3 trigger).
  - `result` → accumulate `usage` for the gauge's secondary token display.

### Unit 2 — Trigger wiring

- **App restart (renderer-driven, no new main store):** the renderer already
  persists `status`. On reattach (`ChatHost.tsx`), if persisted status was
  `running` (mid-work), open with a new `continueWork: true` flag → the registry
  resumes **and injects the continuation prompt**. If status was `awaiting`
  (cleanly waiting on the user), resume-and-idle exactly as today — **no surprise
  relaunch**. A persisted `limited` status → schedule/await reset (Unit 3).
- **Sleep:** rely first on the SDK's own `api_retry`. Backstop for long sleeps
  that exhaust retries: a **watchdog** (no stream activity for `T` seconds on a
  `running` turn, default `T = 90s`) + `powerMonitor.on('resume')` (main) → treat
  as unexpected stop → auto-continue.
- **Subscription limit:** on `rate_limit_event.status === 'rejected'`, enter a
  `limited` state, emit `limited { resetsAt, rateLimitType }`, schedule a timer
  for `resetsAt` (exponential backoff if `resetsAt` missing), and auto-continue
  when it fires.

### Unit 3 — Subscription usage gauge

- **Source of truth:** last-known `SDKRateLimitInfo`, cached to the main store
  whenever *any* chat emits a `rate_limit_event`; exposed via a `subscriptionUsage`
  tRPC query + subscription.
- **Settings:** keep the worker's `subscriptionPlan` enum; `SUBSCRIPTION_LIMITS`
  is now a **display label** ("Max 20×") + fallback budget only if the SDK never
  reports utilization. (Stripped comments already restored in `settings.ts`.)
- **UI:**
  - `SubscriptionWidget.tsx` on the Dashboard `.dash-rail` — a utilization gauge
    (green / amber / red by `status`), "resets in 2h 14m" countdown, and
    `rateLimitType` label. Shows "Paused — resuming in Xm" when a run is `limited`.
  - Compact inline chip in `ProcessesStrip.tsx` / chat header for the transient
    run states: `reconnecting`, `limited — resumes in Xm`, `resuming`.
  - `Settings.tsx` plan picker (+ custom limit field) using the existing form.

## New events & data flow

New `BaseChatEvent` variants (in `src/shared/ipc-events`): `reconnecting`,
`rate-limit`, `limited`, `resuming`. New renderer statuses in
`createChatRunStore.ts`: `reconnecting`, `limited` (+ handling in `ChatHost.tsx`).

```
SDK message ─▶ resumableRun (classify) ─▶ push(event) ─▶ registry (intent + auto-continue + loop guard)
                                              │                        │
                                              └─▶ subscriptionUsage store (cache rate_limit_info)
                                              └─▶ tRPC observable ─▶ ChatHost ─▶ createChatRunStore ─▶ chat UI + widgets
```

## Files touched

- **Main:** `chat/registry.ts` (intent, auto-continue, loop guard, timers),
  `chat/resumableRun.ts` (handle `api_retry` / `rate_limit_event` / `result.usage`,
  watchdog), new `subscriptionUsage` store slice + tRPC router, `powerMonitor` wiring.
- **Shared:** `ipc-events` (new event variants), `settings.ts` (comments restored,
  semantics adjusted — done).
- **Renderer:** `createChatRunStore.ts` (+ statuses), `ChatHost.tsx` (`continueWork`
  + new events), `SubscriptionWidget.tsx` (new), `ProcessesStrip.tsx` (chip),
  `Dashboard.tsx` (mount widget), `Settings.tsx` (plan picker).
- **Cleanup:** `settings.ts` comments restored (done); keep/extend `settings.test.ts`.

## Testing

- **Unit:** unexpected-stop classification; loop-guard counter (resets on
  activity, stops at cap); `resetsAt` → delay math (incl. missing → backoff);
  rate-limit-info reducer; existing `subscriptionLimitTokens`.
- **Integration:** a **fake SDK message stream** (the SDK is `await import`-ed in
  `resumableRun.ts`, so it is mockable) injecting `api_retry`,
  `rate_limit_event{ status:'rejected', resetsAt }`, and an error `result`;
  assert emitted events and that auto-continue re-issues a `query({resume})` with
  the continuation prompt.
- **Manual smoke:** real worker task → quit + relaunch app mid-turn → auto-continues;
  sleep the Mac mid-turn → `reconnecting` then continues; limit simulated via an
  injected `rate_limit_event` (hard to force a real one on demand).

## Non-goals / YAGNI

- No literal process freeze/thaw — continuation is a re-issued turn.
- No new main-side persistent session store (restart intent rides on the existing
  renderer persistence).
- No manual token metering for the gauge — the SDK's `utilization` is authoritative.

## Notes on the currently-hung worker

This feature is the fix, but it cannot retro-actively rescue the already-dead
turn. Once shipped, that session auto-continues on next launch (or via Resume).
The worker's uncommitted subscription-gauge work is folded in and cleaned up here.
