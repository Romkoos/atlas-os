# Chat Resume — Design

**Date:** 2026-07-02
**Status:** Approved design → implementation plan pending

## Goal

Make every chat in the unified drawer survive a page refresh **and** a full app
restart, reattaching to the same Claude session with full context — including an
in-flight reply that was streaming when the reload happened.

Four chat types exist today (`benchmark`, `roadmap`, `skillImprover`,
`generalChat`), each with its own run service, tRPC router, run store, and
App-level host. The resume mechanism must be a **generic transport layer** that
all four migrate onto, so any chat added later inherits resume for free.

## Non-goals

- Persisting or resuming non-chat runs (news, trending, graph deep-map).
- Multiplexing more than one live session per chat type (the drawer is still
  one session per type; `id === type` semantics stay for the drawer, but the
  resumable identity is a separate stable UUID — see below).
- **App-restart resume for `skillImprover`.** Its run owns a transactional
  filesystem workspace (backup / apply / revert / cleanup). It gets
  reattach-on-refresh (main process alive, workspace intact) but **not**
  app-restart resume — rehydrating a half-applied skill edit is unsafe.
  App-restart resume for skillImprover is a flagged follow-up.

## What makes this tractable: the Agent SDK already persists sessions

From `@anthropic-ai/claude-agent-sdk` (`sdk.d.ts`):

- `query({ options: { sessionId: <uuid> } })` — assign our **own** stable
  session UUID on first start (must be a valid UUID). Mutually exclusive with
  `resume` unless `forkSession` is set.
- `query({ options: { resume: <uuid> } })` — reload that session's full
  conversation history from disk and continue it.
- The SDK writes every session to `~/.claude/projects/<dir>/<sessionId>.jsonl`
  automatically; each `SDKMessage` carries `session_id`.

So the Claude conversation context is already durable on disk. We do not
reconstruct it — we keep a stable id, avoid killing the run on teardown, and
reattach (main alive) or resume-from-disk (main restarted) on load.

## The two loss layers a reload causes

1. **Renderer state** — drawer open/tabs (`chatDrawer`) and transcript/status
   (`*ChatRun` stores) are in-memory zustand, wiped on reload.
2. **Backend session** — the run is `cancel()`-ed on tRPC subscription teardown
   today (e.g. `generalChat.ts:42-49`); a full app restart kills the main
   process and every in-memory run with it.

## Architecture

### 1. Stable session identity

Replace the per-start random `requestId` with **one persisted session UUID per
chat tab** (`sessionId`, `crypto.randomUUID()`). It:

- is passed to the SDK as `options.sessionId` on first start and
  `options.resume` on rehydration;
- keys the backend registry;
- is persisted in the renderer run store (localStorage).

`requestId` effectively becomes this stable id (no longer regenerated per
start). The drawer's `ChatSession.id === type` convention is unchanged — the
resumable `sessionId` lives in the run store, not the drawer store.

### 2. Backend: generic `ChatSessionRegistry`

New module `src/main/services/chat/registry.ts`. One record per live session:

```ts
interface ChatSessionRecord {
  sessionId: string
  type: ChatSessionType
  run: ResumableRun            // reply()/cancel()/done
  buffer: SeqEvent[]           // append-only, capped ring
  nextSeq: number
  status: 'running' | 'awaiting' | 'done' | 'error'
  subscriber: ((e: SeqEvent) => void) | null   // at most one attached emitter
  cwd: string
}
```

Key behaviours:

- **Lifecycle is decoupled from the subscription.** On subscription teardown
  the registry **detaches the emitter** (`subscriber = null`) — it does **not**
  `cancel()` the run. The SDK streaming-input session stays open across turns.
  Only an explicit tab-close/cancel ends a session (removes the record + closes
  the mailbox).
- **Event buffer + sequence numbers.** Every emitted domain event is wrapped as
  `{ seq, event }`, appended to `buffer`, and forwarded to the current
  subscriber if attached. `seq` is monotonic per session. Buffer is capped
  (e.g. last N events / bounded bytes) to avoid unbounded growth on long
  sessions — capping only limits gap-replay depth, never the on-disk transcript.
- **`open(input, emit)` entry point** (called from each router's subscription):
  - Record exists (renderer refresh, main alive): attach `emit` as the
    subscriber and **replay `buffer` where `seq > input.lastSeq`**, then stream
    live. This is what preserves tokens generated during the reload window.
  - No record + `input.kickoff` present (brand-new chat): create record, start a
    run with `options.sessionId: input.sessionId` and a mailbox seeded with the
    kickoff message.
  - No record + no kickoff (app restarted, renderer has persisted sessionId):
    start a run with `options.resume: input.sessionId` and an **empty** mailbox
    (SDK loads history from disk and idles awaiting input); emit
    `awaiting-input` so the composer re-enables.

### 3. Backend: generic `startResumableChat`

New module `src/main/services/chat/resumableRun.ts` wrapping today's query loop
(the near-identical bodies of `generalChat/run.ts`, `roadmapChat/run.ts`, etc.):

```ts
startResumableChat({
  sessionId, seed, model, tools, cwd, settingSources,
  resume,                       // boolean → options.resume vs options.sessionId
  emit,                         // registry-provided; buffers + fans out
  onStreamText?,                // per-type hook (roadmap proposal, improver sentinel)
  onToolUse?,                   // per-type tool summary
}): ResumableRun
```

- Chooses `options.sessionId` (new) or `options.resume` (rehydrate) from
  `resume`.
- Emits the same domain events as today (`token` / `tool` / `awaiting-input` /
  `done` / `error` / `aborted`) through the registry.
- `createMailbox` gains an optional initial: `createMailbox()` starts empty for
  the resume path (validate: an empty streaming-input prompt with `resume`
  should idle awaiting input — see Risks).

Per-type domain logic (roadmap's `checkProposal`, benchmark's graph context,
skillImprover's workspace/sentinel/report, general's plain passthrough) stays as
injected callbacks. **The transport is generic; the domain logic is not.**

### 4. tRPC contract

Each chat router keeps `reply` and `cancel` (retargeted to the registry by
`sessionId`) and replaces `start` with one subscription `open`:

```ts
open: subscription(input: {
  sessionId: string
  lastSeq: number            // renderer's last applied seq; 0 on first open
  kickoff?: string           // present only for a brand-new session
}) -> yields { seq, event: <DomainEvent> }
```

The subscription delegates entirely to `registry.open(...)`. Teardown calls
`registry.detach(sessionId)` (not cancel).

### 5. Renderer: persistence + reattach

- **Persist stores** with the existing `guardedStorage` + sanitizer-merge
  pattern from `ui.ts:41-92`:
  - `chatDrawer`: `open`, `sessions`, `activeSessionId`.
  - each run store: `sessionId`, `transcript`, `status`, `awaitingInput`,
    `lastSeq` — **not** `running` (re-derived on reattach) or `streaming`
    (transient partial).
- **Reattach on mount.** Each always-mounted host (`App.tsx:75-80`) checks its
  persisted run store: if `status` was `running`/`awaiting`, subscribe with
  `{ sessionId, lastSeq }` and no `kickoff`. The subscription resolves via the
  registry to reattach-live (main alive) or resume-from-disk (main restarted).
- Every applied event advances `lastSeq` in the store.

### 6. Renderer: generic store + host

Collapse the four near-identical stores and hosts:

- `createChatRunStore(type)` — factory producing a persisted zustand store with
  the shared shape (`sessionId`, `transcript`, `streaming`, `status`,
  `awaitingInput`, `lastSeq`, + actions). Domain extras (`savedItem` for
  roadmap, `report` for skillImprover) are added via a per-type slice.
- generic `ChatHost` — takes the store + the type's tRPC `open` endpoint, hosts
  the subscription and the reattach-on-mount logic. Replaces
  `GeneralChatHost` / `RoadmapChatHost` / `BenchmarkChatHost` / `SkillImproverHost`.

A future chat = register a type config (tools, cwd, seed builder, domain hooks)
+ mount one `ChatHost`. Resume is inherited.

## Data flow

- **Renderer refresh (main alive):** stores rehydrate from localStorage →
  transcript visible immediately → host reattaches `{ sessionId, lastSeq }` →
  registry replays buffered events `seq > lastSeq` (any mid-reload tokens) →
  live stream continues. Mid-reply keeps streaming.
- **App restart (main dead):** stores rehydrate from localStorage → transcript
  visible → host opens `{ sessionId, lastSeq }` with no live record → registry
  starts `query({ resume: sessionId })` → SDK reloads on-disk history → composer
  re-enables. Next message continues with full context.
- **Tab close / cancel:** `cancel` mutation → registry closes mailbox, aborts
  query, removes record, clears buffer; store `reset()`.
- **skillImprover, app restart:** persisted store shows the transcript
  read-only; no live record and resume is disabled for this type → the session
  is treated as ended (no unsafe workspace rehydration).

## Per-type migration notes

- **generalChat** — pure passthrough; the reference migration.
- **roadmap** — keep `onProposal`/`saved`; `savedItem` persisted in the slice.
- **benchmark** — seed binds to a benchmark run's context; that context must be
  rebuildable on resume (persist the benchmark run id in the slice, rebuild seed
  on app-restart resume).
- **skillImprover** — reattach-on-refresh only; `accept`/`reject`/`report`/
  workspace flow unchanged; app-restart resume disabled for this type.

## Persistence schema

- localStorage keys: `atlas-chat-drawer`, `atlas-chat-run-<type>` (versioned,
  each with a `mergePersisted*` sanitizer like `mergePersistedUi`).
- Sanitizers coerce partial/stale/corrupt blobs into valid state and always keep
  live action functions from `current` (same contract as `mergePersistedUi`).

## Risks / validation items

- **Empty-mailbox resume behaviour.** Confirm a streaming-input `query` with
  `options.resume` and no initial user message idles awaiting input rather than
  erroring. Fallback: send a benign no-op continuation, or gate the composer
  until the first user reply re-opens the mailbox.
- **cwd must match on resume.** The SDK keys the on-disk session by cwd; each
  type's cwd is fixed (repoRoot for general/roadmap/benchmark, homedir for
  improver), so persist/derive cwd per type and pass it on resume.
- **Buffer cap vs mid-reload gap.** The cap bounds gap-replay depth; a reload
  longer than the buffer window could still drop the oldest missed tokens. Size
  the cap to comfortably exceed a realistic reload window.
- **Stale sessionId after transcript deletion.** If the SDK session file was
  pruned, `resume` fails — handle by falling back to a fresh session and
  surfacing a toast rather than crashing.
- **Model mismatch on resume.** If the user changed the model between sessions,
  resume still uses the persisted session; note the model used at start.

## Testing

- Unit: registry (attach/detach without cancel, seq buffering, replay from
  lastSeq, open-new vs open-resume branching); `mergePersisted*` sanitizers;
  `createMailbox()` empty-start.
- Integration: renderer-refresh reattach replays a mid-reload token gap;
  app-restart resume rehydrates history and re-enables the composer; tab-close
  fully tears down.
- e2e brand strings unchanged (per prior conventions).
