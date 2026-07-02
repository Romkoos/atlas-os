# Chat Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every unified-drawer chat survive a renderer refresh and a full app restart, reattaching to the same Claude session (including an in-flight streaming reply).

**Architecture:** A generic backend transport layer — a `ChatSessionRegistry` whose session records outlive tRPC subscriptions, an append-only per-session event buffer keyed by a monotonic sequence number, and a `startResumableChat` wrapper that uses the Agent SDK's `options.sessionId` (new) / `options.resume` (rehydrate-from-disk). A generic renderer `createChatRunStore` factory (persisted to localStorage) plus a generic `ChatHost` that reattaches on mount. All four chat types (`generalChat`, `roadmap`, `benchmark`, `skillImprover`) migrate onto it; `skillImprover` is reattach-on-refresh only.

**Tech Stack:** Electron + tRPC (`@trpc/server` observables over IPC), zustand (+ `persist` middleware), `@anthropic-ai/claude-agent-sdk` (`query()` streaming-input), vitest, biome.

## Global Constraints

- All UI strings and agent prompts in **English** only (generated digest content may be Russian). — from [[ui-strings-always-english]].
- Custom Tailwind utilities like `mt-16` must stay unlayered (spacing standards: 20/60 padding). — from [[tailwind-mt-utility-collision]].
- The Agent SDK's `options.sessionId` **must be a valid UUID**; `sessionId` is mutually exclusive with `resume` unless `forkSession` is set (we never set `forkSession`).
- Each chat type's `cwd` is fixed and must match on resume: `app.getAppPath()` (repoRoot) for `generalChat`/`roadmap`/`benchmark`; `homedir()` for `skillImprover`.
- Run commits on a feature branch (`feat/chat-resume`, already created). Do not push unless asked; pushing to `origin` (github.com/Romkoos/atlas-os) is allowed. — from [[no-push-user-pushes]].
- `pnpm dev` after a plain-Node rebuild can hit `NODE_MODULE_VERSION` mismatch on `better-sqlite3`; fix with electron-rebuild if DB-touching tests fail to load. — from [[better-sqlite3-abi-electron-rebuild]].
- Verify commands: `pnpm lint` (biome), `pnpm typecheck`, `pnpm test` (vitest). Pre-existing biome warnings in `Galaxy3D.tsx` / `d3-force-3d.d.ts` are unrelated — do not "fix" them.

---

## File structure

**Backend (new):**
- `src/main/services/chat/resumableRun.ts` — generic streaming-input query wrapper (new vs resume).
- `src/main/services/chat/registry.ts` — `ChatSessionRegistry`: session records, event buffer, seq, attach/detach/open/reply/cancel.
- Tests: `src/main/services/chat/resumableRun.test.ts`, `src/main/services/chat/registry.test.ts`.

**Backend (modify):**
- `src/main/services/skillImprover/mailbox.ts` — make initial message optional (empty-start for resume).
- `src/shared/ipc-events.ts` — add `SeqEnvelope`, factor a `BaseChatEvent` the four events reuse.
- `src/main/trpc/routers/{generalChat,roadmapChat,benchmarkChat,skillImprover}.ts` — `start` subscription → `open` via registry; `reply`/`cancel` retarget the registry by `sessionId`.

**Renderer (new):**
- `src/renderer/src/store/createChatRunStore.ts` — persisted store factory + shared types + sanitizer.
- `src/renderer/src/components/ChatHost.tsx` — generic always-mounted host (subscribe + reattach-on-mount + seq tracking).
- Tests: `src/renderer/src/store/createChatRunStore.test.ts`, `src/renderer/src/store/chatDrawer.persist.test.ts`.

**Renderer (modify):**
- `src/renderer/src/store/chatDrawer.ts` — add `persist` + sanitizer.
- `src/renderer/src/store/{generalChatRun,roadmapChatRun,benchmarkChatRun,skillImproverRun}.ts` — rebuilt on the factory.
- `src/renderer/src/components/{GeneralChat,RoadmapChat,BenchmarkChat,SkillImprover}Overlay.tsx` — `requestId`→`sessionId`, `reply` mutation → `open` semantics.
- `src/renderer/src/components/UnifiedChatDrawer.tsx` — cancel targets `sessionId`.
- `src/renderer/src/App.tsx` — replace the four `*Host` mounts with generic `ChatHost` instances.
- Delete: `src/renderer/src/components/{GeneralChat,RoadmapChat,BenchmarkChat,SkillImprover}Host.tsx` (folded into `ChatHost`).

---

## Task 1: Empty-start mailbox

**Files:**
- Modify: `src/main/services/skillImprover/mailbox.ts:20`
- Test: `src/main/services/skillImprover/mailbox.test.ts`

**Interfaces:**
- Produces: `createMailbox(initial?: string): Mailbox`. With `initial` omitted the queue starts empty (the consumer parks on the first `next()` until `push`/`close`).

- [ ] **Step 1: Write the failing test**

Append to `src/main/services/skillImprover/mailbox.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createMailbox } from './mailbox'

describe('createMailbox empty start', () => {
  it('yields nothing until push when no initial is given', async () => {
    const mailbox = createMailbox()
    const iter = mailbox.stream[Symbol.asyncIterator]()
    const pending = iter.next()
    mailbox.push('first reply')
    const first = await pending
    expect(first.done).toBe(false)
    expect(first.value.message.content).toBe('first reply')
  })

  it('ends immediately when closed before any push', async () => {
    const mailbox = createMailbox()
    const iter = mailbox.stream[Symbol.asyncIterator]()
    const pending = iter.next()
    mailbox.close()
    expect((await pending).done).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/skillImprover/mailbox.test.ts`
Expected: FAIL — the current signature requires `initial`, so `createMailbox()` seeds an `undefined` message.

- [ ] **Step 3: Make the initial optional**

In `src/main/services/skillImprover/mailbox.ts`, change the signature and seed:

```ts
export function createMailbox(initial?: string): Mailbox {
  const queue: SDKUserMessage[] = initial === undefined ? [] : [userMessage(initial)]
  let closed = false
  // ...rest unchanged
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/main/services/skillImprover/mailbox.test.ts`
Expected: PASS (existing seeded-mailbox tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/skillImprover/mailbox.ts src/main/services/skillImprover/mailbox.test.ts
git commit -m "feat(chat): allow empty-start mailbox for resume"
```

---

## Task 2: Shared seq envelope + base chat event

**Files:**
- Modify: `src/shared/ipc-events.ts`

**Interfaces:**
- Produces:
  - `BaseChatEvent = {type:'token';text} | {type:'tool';name;summary} | {type:'awaiting-input'} | {type:'done'} | {type:'error';message} | {type:'aborted'}`
  - `SeqEnvelope<E> = { seq: number; event: E }`
  - `GeneralChatEvent` and `BenchmarkChatEvent` become `= BaseChatEvent`. `RoadmapChatEvent = BaseChatEvent | {type:'saved';item:RoadmapItem}`. `ImproverEvent` keeps its richer `done`/`aborted`/`report` variants (documented as not fully reducible to `BaseChatEvent`).

- [ ] **Step 1: Add the shared types**

In `src/shared/ipc-events.ts`, add near the top (after imports):

```ts
// Common events shared by every drawer chat's transport layer.
export type BaseChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'awaiting-input' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }

// Every chat event forwarded to the renderer is wrapped with a per-session
// monotonic sequence number so a reattaching client can replay only the gap.
export interface SeqEnvelope<E> {
  seq: number
  event: E
}
```

- [ ] **Step 2: Reuse the base where identical**

Replace the `GeneralChatEvent` and `BenchmarkChatEvent` definitions with:

```ts
export type GeneralChatEvent = BaseChatEvent
export type BenchmarkChatEvent = BaseChatEvent
export type RoadmapChatEvent = BaseChatEvent | { type: 'saved'; item: RoadmapItem }
```

Leave `ImproverEvent` unchanged (its `done`/`aborted` carry `tokens`/`durationMs` and it adds `report`).

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS — the shapes are structurally identical to the old unions, so existing consumers compile unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/shared/ipc-events.ts
git commit -m "feat(chat): shared BaseChatEvent + SeqEnvelope types"
```

---

## Task 3: Generic resumable run wrapper

**Files:**
- Create: `src/main/services/chat/resumableRun.ts`
- Test: `src/main/services/chat/resumableRun.test.ts`

**Interfaces:**
- Consumes: `createMailbox` (Task 1), `BaseChatEvent` (Task 2), `subscriptionEnv`.
- Produces:

```ts
export interface ResumableRun { reply: (text: string) => void; cancel: () => void; done: Promise<void> }
export type SettingSource = 'user' | 'project' | 'local'
export interface StartResumableChatOptions {
  sessionId: string
  model: string
  cwd: string
  allowedTools: string[]
  settingSources: SettingSource[]
  env: Record<string, string>
  seed?: string          // present → new session; omit when resume === true
  resume: boolean        // true → options.resume; false → options.sessionId
  emit: (event: BaseChatEvent) => void
  onAssistantText?: (delta: string, accumulated: string) => void
  onTurnComplete?: (accumulated: string) => void
}
export function startResumableChat(opts: StartResumableChatOptions): ResumableRun
```

- [ ] **Step 1: Write the failing test**

`src/main/services/chat/resumableRun.test.ts` — inject a fake `query` via a module mock so no real SDK/network runs:

```ts
import { describe, expect, it, vi } from 'vitest'

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }))
vi.mock('@main/services/llm/subscriptionEnv', () => ({ subscriptionEnv: () => ({}) }))

import { startResumableChat } from './resumableRun'

function fakeQuery(messages: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m
    },
    interrupt: async () => {},
  }
}

describe('startResumableChat', () => {
  it('passes options.sessionId for a new session and emits token+awaiting', async () => {
    let captured: any
    queryMock.mockImplementation((arg: any) => {
      captured = arg
      return fakeQuery([
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } },
        { type: 'result', subtype: 'success' },
      ])
    })
    const events: any[] = []
    const run = startResumableChat({
      sessionId: 'uuid-1', model: 'claude-opus-4-8', cwd: '/repo',
      allowedTools: ['Read'], settingSources: ['user'], env: {},
      seed: 'hello', resume: false, emit: (e) => events.push(e),
    })
    await run.done
    expect(captured.options.sessionId).toBe('uuid-1')
    expect(captured.options.resume).toBeUndefined()
    expect(events).toEqual([{ type: 'token', text: 'hi' }, { type: 'awaiting-input' }])
  })

  it('passes options.resume when resuming with no seed', async () => {
    let captured: any
    queryMock.mockImplementation((arg: any) => { captured = arg; return fakeQuery([{ type: 'result', subtype: 'success' }]) })
    const run = startResumableChat({
      sessionId: 'uuid-2', model: 'm', cwd: '/repo', allowedTools: [], settingSources: ['user'], env: {},
      resume: true, emit: () => {},
    })
    await run.done
    expect(captured.options.resume).toBe('uuid-2')
    expect(captured.options.sessionId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/chat/resumableRun.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the wrapper**

```ts
// src/main/services/chat/resumableRun.ts
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@main/logger'
import { createMailbox, type Mailbox } from '@main/services/skillImprover/mailbox'
import type { BaseChatEvent } from '@shared/ipc-events'

export interface ResumableRun {
  reply: (text: string) => void
  cancel: () => void
  done: Promise<void>
}
export type SettingSource = 'user' | 'project' | 'local'

export interface StartResumableChatOptions {
  sessionId: string
  model: string
  cwd: string
  allowedTools: string[]
  settingSources: SettingSource[]
  env: Record<string, string>
  seed?: string
  resume: boolean
  emit: (event: BaseChatEvent) => void
  onAssistantText?: (delta: string, accumulated: string) => void
  onTurnComplete?: (accumulated: string) => void
}

// Generic streaming-input chat run. On a new session we assign our own stable
// UUID (options.sessionId); on rehydration we resume the on-disk session
// (options.resume) with an empty mailbox so the SDK loads history and idles.
export function startResumableChat(opts: StartResumableChatOptions): ResumableRun {
  const controller = new AbortController()
  let queryRef: Query | null = null
  let mailbox: Mailbox | null = null
  let stopped = false
  let accumulated = ''

  const done = (async (): Promise<void> => {
    mailbox = createMailbox(opts.resume ? undefined : opts.seed)
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt: mailbox.stream,
      options: {
        model: opts.model,
        allowedTools: opts.allowedTools,
        permissionMode: 'bypassPermissions',
        settingSources: opts.settingSources,
        includePartialMessages: true,
        cwd: opts.cwd,
        env: opts.env,
        abortController: controller,
        ...(opts.resume ? { resume: opts.sessionId } : { sessionId: opts.sessionId }),
      },
    })
    queryRef = q

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          accumulated += event.delta.text
          opts.emit({ type: 'token', text: event.delta.text })
          opts.onAssistantText?.(event.delta.text, accumulated)
        }
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            opts.emit({ type: 'tool', name: block.name, summary: summarizeTool(block) })
          }
        }
      } else if (message.type === 'result') {
        if (stopped) continue
        opts.onTurnComplete?.(accumulated)
        accumulated = ''
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
    logger.error('Resumable chat failed', message)
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

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/main/services/chat/resumableRun.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/chat/resumableRun.ts src/main/services/chat/resumableRun.test.ts
git commit -m "feat(chat): generic resumable streaming-input run wrapper"
```

---

## Task 4: ChatSessionRegistry

**Files:**
- Create: `src/main/services/chat/registry.ts`
- Test: `src/main/services/chat/registry.test.ts`

**Interfaces:**
- Consumes: `ResumableRun` (Task 3), `SeqEnvelope` (Task 2), `ChatSessionType` (from `@renderer/store/chatDrawer` — re-declare locally in shared to avoid a renderer import; see Step 3).
- Produces:

```ts
export interface OpenParams {
  sessionId: string
  lastSeq: number
  kickoff?: string
  resumable: boolean               // false → no app-restart resume (skillImprover)
  buildRun: (args: { resume: boolean; kickoff?: string; push: (event: unknown) => void }) => ResumableRun
}
export class ChatSessionRegistry {
  open(params: OpenParams, emit: (env: SeqEnvelope<unknown>) => void): () => void
  reply(sessionId: string, text: string): boolean
  cancel(sessionId: string): boolean
}
export const chatRegistry: ChatSessionRegistry
```

Behaviour: `open` attaches to a live record (replaying buffered envelopes with `seq > lastSeq`) or builds a new run (resume when `kickoff` absent). When `!resumable && !kickoff && no record` it emits a terminal `{type:'aborted'}` envelope and starts nothing. `open`'s teardown detaches the subscriber; it never cancels the run. Terminal events (`done`/`error`/`aborted`) delete the record.

- [ ] **Step 1: Write the failing test**

```ts
// src/main/services/chat/registry.test.ts
import { describe, expect, it, vi } from 'vitest'
import { ChatSessionRegistry } from './registry'
import type { ResumableRun } from './resumableRun'

function stubRun(): ResumableRun { return { reply: vi.fn(), cancel: vi.fn(), done: Promise.resolve() } }

describe('ChatSessionRegistry', () => {
  it('builds a new run with resume=false when kickoff present', () => {
    const reg = new ChatSessionRegistry()
    let resumeSeen: boolean | undefined
    const events: any[] = []
    reg.open(
      { sessionId: 's1', lastSeq: 0, kickoff: 'hi', resumable: true,
        buildRun: ({ resume, push }) => { resumeSeen = resume; push({ type: 'token', text: 'a' }); return stubRun() } },
      (env) => events.push(env),
    )
    expect(resumeSeen).toBe(false)
    expect(events).toEqual([{ seq: 1, event: { type: 'token', text: 'a' } }])
  })

  it('builds a resume run (resume=true) when no kickoff and no live record', () => {
    const reg = new ChatSessionRegistry()
    let resumeSeen: boolean | undefined
    reg.open(
      { sessionId: 's2', lastSeq: 0, resumable: true,
        buildRun: ({ resume, push }) => { resumeSeen = resume; push({ type: 'awaiting-input' }); return stubRun() } },
      () => {},
    )
    expect(resumeSeen).toBe(true)
  })

  it('replays only the gap on reattach and does not rebuild the run', () => {
    const reg = new ChatSessionRegistry()
    let builds = 0
    let push!: (e: unknown) => void
    reg.open(
      { sessionId: 's3', lastSeq: 0, kickoff: 'hi', resumable: true,
        buildRun: (a) => { builds++; push = a.push; return stubRun() } },
      () => {},
    )
    push({ type: 'token', text: 'x' }) // seq 1
    push({ type: 'token', text: 'y' }) // seq 2
    const replayed: any[] = []
    reg.open({ sessionId: 's3', lastSeq: 1, resumable: true, buildRun: (a) => { builds++; return stubRun() } },
      (env) => replayed.push(env))
    expect(builds).toBe(1) // no rebuild
    expect(replayed).toEqual([{ seq: 2, event: { type: 'token', text: 'y' } }])
  })

  it('emits aborted and starts nothing for a non-resumable dead session', () => {
    const reg = new ChatSessionRegistry()
    let built = false
    const events: any[] = []
    reg.open({ sessionId: 's4', lastSeq: 0, resumable: false, buildRun: () => { built = true; return stubRun() } },
      (env) => events.push(env))
    expect(built).toBe(false)
    expect(events).toEqual([{ seq: 1, event: { type: 'aborted' } }])
  })

  it('teardown detaches without cancelling the run', () => {
    const reg = new ChatSessionRegistry()
    const run = stubRun()
    const teardown = reg.open(
      { sessionId: 's5', lastSeq: 0, kickoff: 'hi', resumable: true, buildRun: () => run }, () => {})
    teardown()
    expect(run.cancel).not.toHaveBeenCalled()
    expect(reg.reply('s5', 'later')).toBe(true) // record still alive
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/main/services/chat/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the registry**

```ts
// src/main/services/chat/registry.ts
import type { SeqEnvelope } from '@shared/ipc-events'
import type { ResumableRun } from './resumableRun'

const BUFFER_CAP = 4000 // envelopes; bounds gap-replay depth, not the on-disk transcript

type Subscriber = (env: SeqEnvelope<unknown>) => void
type Status = 'running' | 'awaiting' | 'done' | 'error'

interface Record {
  sessionId: string
  run: ResumableRun
  buffer: SeqEnvelope<unknown>[]
  nextSeq: number
  status: Status
  subscriber: Subscriber | null
}

export interface OpenParams {
  sessionId: string
  lastSeq: number
  kickoff?: string
  resumable: boolean
  buildRun: (args: { resume: boolean; kickoff?: string; push: (event: unknown) => void }) => ResumableRun
}

function nextStatus(event: unknown, prev: Status): Status {
  const type = (event as { type?: string }).type
  if (type === 'awaiting-input') return 'awaiting'
  if (type === 'error') return 'error'
  if (type === 'done' || type === 'aborted') return 'done'
  return prev === 'awaiting' ? 'running' : prev
}

function isTerminal(event: unknown): boolean {
  const type = (event as { type?: string }).type
  return type === 'aborted' || type === 'error' || type === 'done'
}

export class ChatSessionRegistry {
  private records = new Map<string, Record>()

  open(params: OpenParams, emit: Subscriber): () => void {
    const existing = this.records.get(params.sessionId)
    if (existing) {
      existing.subscriber = emit
      for (const env of existing.buffer) if (env.seq > params.lastSeq) emit(env)
      return () => {
        if (existing.subscriber === emit) existing.subscriber = null
      }
    }

    // No live record. A brand-new session has a kickoff; otherwise resume from disk.
    const resume = params.kickoff === undefined
    if (resume && !params.resumable) {
      // Non-resumable type after an app restart: the session is dead. Report it ended.
      emit({ seq: 1, event: { type: 'aborted' } })
      return () => {}
    }

    const record: Record = {
      sessionId: params.sessionId,
      run: undefined as unknown as ResumableRun,
      buffer: [],
      nextSeq: 1,
      status: 'running',
      subscriber: emit,
    }
    this.records.set(params.sessionId, record)

    const push = (event: unknown) => {
      const env: SeqEnvelope<unknown> = { seq: record.nextSeq++, event }
      record.buffer.push(env)
      if (record.buffer.length > BUFFER_CAP) record.buffer.shift()
      record.status = nextStatus(event, record.status)
      record.subscriber?.(env)
      if (isTerminal(event)) this.records.delete(params.sessionId)
    }

    record.run = params.buildRun({ resume, kickoff: params.kickoff, push })
    return () => {
      if (record.subscriber === emit) record.subscriber = null
    }
  }

  reply(sessionId: string, text: string): boolean {
    const record = this.records.get(sessionId)
    record?.run.reply(text)
    return Boolean(record)
  }

  cancel(sessionId: string): boolean {
    const record = this.records.get(sessionId)
    record?.run.cancel()
    this.records.delete(sessionId)
    return Boolean(record)
  }
}

export const chatRegistry = new ChatSessionRegistry()
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/main/services/chat/registry.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/chat/registry.ts src/main/services/chat/registry.test.ts
git commit -m "feat(chat): ChatSessionRegistry with event buffer + reattach"
```

---

## Task 5: Migrate generalChat router onto the registry

**Files:**
- Modify: `src/main/trpc/routers/generalChat.ts`

**Interfaces:**
- Consumes: `chatRegistry` (Task 4), `startResumableChat` (Task 3), `buildGeneralChatSeed`, `SeqEnvelope`, `BaseChatEvent`.
- Produces: `generalChat.open` subscription (`{sessionId, lastSeq, kickoff?}` → `SeqEnvelope<BaseChatEvent>`); `generalChat.reply({sessionId,text})`; `generalChat.cancel({sessionId})`. The `start` subscription is removed.

- [ ] **Step 1: Rewrite the router**

```ts
// src/main/trpc/routers/generalChat.ts
import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { buildGeneralChatSeed } from '@main/services/generalChat/seed'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { BaseChatEvent, SeqEnvelope } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { app } from 'electron'
import { z } from 'zod'

const CHAT_TOOLS = ['Read', 'Grep', 'Glob']

export const generalChatRouter = router({
  open: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        lastSeq: z.number().int().nonnegative(),
        kickoff: z.string().min(1).optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<BaseChatEvent>>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const repoRoot = app.getAppPath()
        const teardown = chatRegistry.open(
          {
            sessionId: input.sessionId,
            lastSeq: input.lastSeq,
            kickoff: input.kickoff,
            resumable: true,
            buildRun: ({ resume, kickoff, push }) => {
              const job = jobRegistry.register({
                kind: 'general.chat',
                label: 'General chat',
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
                seed: kickoff ? buildGeneralChatSeed(kickoff) : undefined,
                resume,
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
        return teardown
      }),
    ),

  reply: publicProcedure
    .input(z.object({ sessionId: z.string().uuid(), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.reply(input.sessionId, input.text) })),

  cancel: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.cancel(input.sessionId) })),
})
```

- [ ] **Step 2: Typecheck (expect renderer break to be flagged)**

Run: `pnpm typecheck:node`
Expected: PASS for node. `typecheck:web` will fail until Task 12 (renderer still calls `generalChat.start`/`reply({requestId})`) — that is expected and fixed in Task 12.

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/generalChat.ts
git commit -m "feat(chat): generalChat router via ChatSessionRegistry"
```

---

## Task 6: Migrate roadmapChat router onto the registry

**Files:**
- Modify: `src/main/trpc/routers/roadmapChat.ts`

**Interfaces:**
- Consumes: `chatRegistry`, `startResumableChat`, `parseRoadmapProposal`, `createRoadmapItem`, `buildRoadmapChatSeed`, graph context helpers.
- Produces: `roadmapChat.open`/`reply`/`cancel` mirroring Task 5, plus a `saved` event pushed from the `onAssistantText` hook. Yields `SeqEnvelope<RoadmapChatEvent>`.

- [ ] **Step 1: Rewrite the router**

Reuse the Task 5 shape. The only differences are the seed, the `saved` push, and the proposal-parsing hook:

```ts
// src/main/trpc/routers/roadmapChat.ts
import { db } from '@main/db/client'
import { logger } from '@main/logger'
import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { getSubgraphContext } from '@main/services/graph/context'
import { loadGraph } from '@main/services/graph/store'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { createRoadmapItem, listRoadmap } from '@main/services/roadmap/store'
import { buildRoadmapChatSeed } from '@main/services/roadmapChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { RoadmapChatEvent, SeqEnvelope } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { parseRoadmapProposal } from '@shared/roadmap'
import { observable } from '@trpc/server/observable'
import { app } from 'electron'
import { z } from 'zod'

const CHAT_TOOLS = ['Read', 'Grep', 'Glob']

export const roadmapChatRouter = router({
  open: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        lastSeq: z.number().int().nonnegative(),
        kickoff: z.string().min(1).optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<RoadmapChatEvent>>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const repoRoot = app.getAppPath()
        const teardown = chatRegistry.open(
          {
            sessionId: input.sessionId,
            lastSeq: input.lastSeq,
            kickoff: input.kickoff,
            resumable: true,
            buildRun: ({ resume, kickoff, push }) => {
              const job = jobRegistry.register({
                kind: 'roadmap.chat',
                label: 'Roadmap idea chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              })
              let saved = false
              const checkProposal = (accumulated: string) => {
                if (saved) return
                const proposal = parseRoadmapProposal(accumulated)
                if (!proposal) return
                saved = true
                try {
                  const item = createRoadmapItem(proposal)
                  logger.info('Roadmap idea saved from chat', { id: item.id, title: item.title })
                  push({ type: 'saved', item })
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Failed to save idea'
                  logger.error('Roadmap idea save failed', message)
                  push({ type: 'error', message })
                }
              }
              let seed: string | undefined
              if (kickoff) {
                const graphContext = getSubgraphContext(loadGraph(db(), repoRoot), {
                  query: kickoff,
                  depth: 1,
                  budget: 1000,
                })
                const baseSeed = buildRoadmapChatSeed(kickoff, listRoadmap())
                seed = graphContext ? `${baseSeed}\n\n${graphContext}` : baseSeed
              }
              return startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd: repoRoot,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                seed,
                resume,
                emit: (event) => {
                  if (event.type === 'done') job.finish('done')
                  if (event.type === 'error' || event.type === 'aborted') job.finish('error')
                  push(event)
                },
                onAssistantText: (_delta, accumulated) => checkProposal(accumulated),
                onTurnComplete: (accumulated) => checkProposal(accumulated),
              })
            },
          },
          (env) => emit.next(env as SeqEnvelope<RoadmapChatEvent>),
        )
        return teardown
      }),
    ),

  reply: publicProcedure
    .input(z.object({ sessionId: z.string().uuid(), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.reply(input.sessionId, input.text) })),

  cancel: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.cancel(input.sessionId) })),
})
```

- [ ] **Step 2: Typecheck node**

Run: `pnpm typecheck:node`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/main/trpc/routers/roadmapChat.ts
git commit -m "feat(chat): roadmapChat router via registry (saved via push)"
```

---

## Task 7: Migrate benchmarkChat router onto the registry

**Files:**
- Modify: `src/main/trpc/routers/benchmarkChat.ts`

**Interfaces:**
- Consumes: `chatRegistry`, `startResumableChat`, `buildBenchmarkChatSeed` (its existing seed builder), the batch/analysis context source.
- Produces: `benchmarkChat.open`/`reply`/`cancel`. **`kickoff` here is the `batchId`** — the seed is rebuilt from it, so app-restart resume works without extra persistence. Yields `SeqEnvelope<BenchmarkChatEvent>`.

- [ ] **Step 1: Read the current router to copy its seed/context source**

Run: `sed -n '1,80p' src/main/trpc/routers/benchmarkChat.ts`
Note the exact seed builder + how it reads batch/analysis data (it currently takes the batchId via `start` input).

- [ ] **Step 2: Rewrite following Task 5, treating `kickoff` as the batchId**

```ts
// src/main/trpc/routers/benchmarkChat.ts — open subscription body
buildRun: ({ resume, kickoff, push }) => {
  const job = jobRegistry.register({
    kind: 'benchmark.chat',
    label: 'Benchmark discussion',
    model,
    abort: () => chatRegistry.cancel(input.sessionId),
  })
  // kickoff === batchId. Rebuild the seed from stored benchmark data so resume works.
  const seed = kickoff ? buildBenchmarkChatSeed(kickoff) : undefined
  return startResumableChat({
    sessionId: input.sessionId,
    model,
    cwd: repoRoot,
    allowedTools: ['Read', 'Grep', 'Glob'],
    settingSources: ['user', 'project'],
    env: subscriptionEnv(),
    seed,
    resume,
    emit: (event) => {
      if (event.type === 'done') job.finish('done')
      if (event.type === 'error' || event.type === 'aborted') job.finish('error')
      push(event)
    },
  })
}
```

Wrap it in the identical `open`/`reply`/`cancel` scaffold as Task 5 (input schema: `sessionId`, `lastSeq`, `kickoff` — the batchId; yields `SeqEnvelope<BenchmarkChatEvent>`). Preserve whatever seed builder the current file uses (adapt `buildBenchmarkChatSeed(kickoff)` to the real function name found in Step 1).

- [ ] **Step 3: Typecheck node**

Run: `pnpm typecheck:node`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/benchmarkChat.ts
git commit -m "feat(chat): benchmarkChat router via registry (batchId as kickoff)"
```

---

## Task 8: Migrate skillImprover router onto the registry (reattach-only)

**Files:**
- Modify: `src/main/trpc/routers/skillImprover.ts`

**Interfaces:**
- Consumes: `chatRegistry`, existing `startImproverRun` (kept — its workspace/accept/reject/report flow is unchanged), the `skillId`.
- Produces: `skillImprover.open`/`reply`/`accept`/`reject`/`cancel`. **`resumable: false`** — after an app restart the registry emits `aborted` and starts nothing (workspace is gone). `kickoff` carries the `skillId`. `accept`/`reject` still target the live run.

- [ ] **Step 1: Read the current router**

Run: `sed -n '1,120p' src/main/trpc/routers/skillImprover.ts`
Note how `accept`/`reject`/`report` are wired and how `startImproverRun` is constructed.

- [ ] **Step 2: Rewrite `start`→`open` with `resumable: false`, keep accept/reject**

Key points for the rewrite:
- `open` input: `{ sessionId, lastSeq, kickoff? }` where `kickoff` is the `skillId`.
- `buildRun`: call the existing `startImproverRun({ requestId: sessionId, skillId: kickoff!, model, emit: push })`. Adapt `startImproverRun`'s return (`reply`/`accept`/`reject`/`cancel`/`done`) to a `ResumableRun` by exposing `reply`/`cancel`/`done`; hold `accept`/`reject` in a module map keyed by `sessionId` so the `accept`/`reject` procedures can reach them (the registry only stores `ResumableRun`).
- `resumable: false`.
- Because `startImproverRun` needs `kickoff` (skillId) to build its workspace, and resume is disabled, `kickoff` is always present when a run is actually built — the registry's non-resumable branch guarantees no build without kickoff.

```ts
// module-level, above the router
const improverControls = new Map<string, { accept: () => Promise<void>; reject: () => Promise<void> }>()
```

```ts
// inside buildRun:
buildRun: ({ push }) => {
  const run = startImproverRun({
    requestId: input.sessionId,
    skillId: input.kickoff as string, // always present: resumable:false blocks build without kickoff
    model,
    emit: push,
  })
  improverControls.set(input.sessionId, { accept: run.accept, reject: run.reject })
  return {
    reply: run.reply,
    cancel: run.cancel,
    done: run.done.finally(() => improverControls.delete(input.sessionId)),
  }
}
```

`accept`/`reject` procedures resolve via `improverControls.get(input.sessionId)`. `cancel` calls `chatRegistry.cancel(input.sessionId)` and `improverControls.delete(input.sessionId)`.

Preserve the `report`/`done`/`aborted` event flow exactly — those events flow through `push` and get buffered like any other, so reattach-on-refresh replays them.

- [ ] **Step 3: Typecheck node**

Run: `pnpm typecheck:node`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/skillImprover.ts
git commit -m "feat(chat): skillImprover router via registry (reattach-only)"
```

---

## Task 9: Renderer chat-run store factory

**Files:**
- Create: `src/renderer/src/store/createChatRunStore.ts`
- Test: `src/renderer/src/store/createChatRunStore.test.ts`

**Interfaces:**
- Consumes: zustand `create`, `persist`, `createJSONStorage` (pattern from `ui.ts:57-92`).
- Produces:

```ts
export interface ChatEntry { kind: 'assistant' | 'tool' | 'user'; text: string }
export type ChatStatus = 'idle' | 'running' | 'awaiting' | 'done' | 'error' | 'aborted'
export interface BaseChatRunState {
  sessionId: string | null
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  status: ChatStatus
  lastSeq: number
  running: boolean
  start: (message: string) => void
  reattach: () => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  bumpSeq: (seq: number) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}
export function createChatRunStore(key: string): UseBoundStore<StoreApi<BaseChatRunState>>
```

Semantics: `start(message)` mints `sessionId = crypto.randomUUID()`, seeds `transcript=[{kind:'user',text:message}]`, `running=true`, `status='running'`, `lastSeq=0`. `reattach()` sets `running=true` (used on mount to re-subscribe an existing `sessionId`). Persisted fields: `sessionId`, `transcript`, `status`, `awaitingInput`, `lastSeq` — **not** `running` (default false) or `streaming`.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/store/createChatRunStore.test.ts
import { describe, expect, it } from 'vitest'
import { createChatRunStore } from './createChatRunStore'

describe('createChatRunStore', () => {
  it('start mints a sessionId and seeds the transcript', () => {
    const useStore = createChatRunStore('atlas-chat-run-test')
    useStore.getState().start('hello')
    const s = useStore.getState()
    expect(s.sessionId).toMatch(/[0-9a-f-]{36}/)
    expect(s.transcript).toEqual([{ kind: 'user', text: 'hello' }])
    expect(s.running).toBe(true)
    expect(s.status).toBe('running')
  })

  it('appendToken accumulates streaming and flushTurn commits it', () => {
    const useStore = createChatRunStore('atlas-chat-run-test2')
    useStore.getState().start('q')
    useStore.getState().appendToken('par')
    useStore.getState().appendToken('tial')
    expect(useStore.getState().streaming).toBe('partial')
    useStore.getState().flushTurn()
    expect(useStore.getState().streaming).toBe('')
    expect(useStore.getState().transcript.at(-1)).toEqual({ kind: 'assistant', text: 'partial' })
  })

  it('bumpSeq advances lastSeq monotonically', () => {
    const useStore = createChatRunStore('atlas-chat-run-test3')
    useStore.getState().bumpSeq(3)
    useStore.getState().bumpSeq(2) // out-of-order is ignored
    expect(useStore.getState().lastSeq).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/renderer/src/store/createChatRunStore.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the factory**

```ts
// src/renderer/src/store/createChatRunStore.ts
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface ChatEntry { kind: 'assistant' | 'tool' | 'user'; text: string }
export type ChatStatus = 'idle' | 'running' | 'awaiting' | 'done' | 'error' | 'aborted'

export interface BaseChatRunState {
  sessionId: string | null
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  status: ChatStatus
  lastSeq: number
  running: boolean
  start: (message: string) => void
  reattach: () => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  bumpSeq: (seq: number) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
}

type Persisted = Pick<
  BaseChatRunState,
  'sessionId' | 'transcript' | 'status' | 'awaitingInput' | 'lastSeq'
>

export function createChatRunStore(key: string) {
  const storage = createJSONStorage<Persisted>(() =>
    typeof localStorage !== 'undefined' ? localStorage : noopStorage,
  )
  return create<BaseChatRunState>()(
    persist(
      (set) => ({
        sessionId: null,
        transcript: [],
        streaming: '',
        awaitingInput: false,
        status: 'idle',
        lastSeq: 0,
        running: false,
        start: (message) =>
          set({
            sessionId: crypto.randomUUID(),
            transcript: [{ kind: 'user', text: message }],
            streaming: '',
            awaitingInput: false,
            status: 'running',
            lastSeq: 0,
            running: true,
          }),
        reattach: () => set({ running: true }),
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
          set((s) => ({ transcript: [...s.transcript, { kind: 'user', text }], awaitingInput: false })),
        setAwaiting: (v) => set({ awaitingInput: v, status: v ? 'awaiting' : 'running' }),
        bumpSeq: (seq) => set((s) => ({ lastSeq: Math.max(s.lastSeq, seq) })),
        finish: (status) => set({ running: false, awaitingInput: false, status }),
        reset: () =>
          set({
            sessionId: null,
            transcript: [],
            streaming: '',
            awaitingInput: false,
            status: 'idle',
            lastSeq: 0,
            running: false,
          }),
      }),
      {
        name: key,
        version: 1,
        storage,
        partialize: (s): Persisted => ({
          sessionId: s.sessionId,
          transcript: s.transcript,
          status: s.status,
          awaitingInput: s.awaitingInput,
          lastSeq: s.lastSeq,
        }),
        // running defaults to false on rehydrate; ChatHost decides whether to reattach.
      },
    ),
  )
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/renderer/src/store/createChatRunStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/createChatRunStore.ts src/renderer/src/store/createChatRunStore.test.ts
git commit -m "feat(chat): persisted chat-run store factory"
```

---

## Task 10: Generic ChatHost

**Files:**
- Create: `src/renderer/src/components/ChatHost.tsx`

**Interfaces:**
- Consumes: `trpc`, a run store from `createChatRunStore` (Task 9), `SeqEnvelope`/`BaseChatEvent`.
- Produces:

```ts
export interface ChatHostProps {
  useRun: UseBoundStore<StoreApi<BaseChatRunState>>
  useOpenSubscription: (input, opts) => void   // e.g. trpc.generalChat.open.useSubscription
  onEvent?: (event: unknown, store: BaseChatRunState) => void  // per-type extras (saved/report)
}
export function ChatHost(props: ChatHostProps): null
```

Behaviour: on mount, if the persisted store has a `sessionId` and `status` was `running`/`awaiting`, call `store.reattach()`. The subscription input is `skipToken` unless `running && sessionId`; input is `{ sessionId, lastSeq, kickoff }` where `kickoff` is only sent on the very first open of a brand-new session. Each envelope: `store.bumpSeq(seq)`, then dispatch the base event to the store (`token`→appendToken, `tool`→pushTool, `awaiting-input`→flushTurn+setAwaiting(true), `done`→flushTurn+finish('done'), `error`→finish('error')+toast, `aborted`→finish('aborted')), then `onEvent?.(event, store)` for extras.

- [ ] **Step 1: Implement ChatHost**

```tsx
// src/renderer/src/components/ChatHost.tsx
import type { BaseChatRunState } from '@renderer/store/createChatRunStore'
import { skipToken } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'
import type { StoreApi, UseBoundStore } from 'zustand'

interface OpenInput {
  sessionId: string
  lastSeq: number
  kickoff?: string
}

export interface ChatHostProps {
  useRun: UseBoundStore<StoreApi<BaseChatRunState>>
  useOpenSubscription: (
    input: OpenInput | typeof skipToken,
    opts: { onData: (env: { seq: number; event: unknown }) => void; onError: (e: { message: string }) => void },
  ) => void
  // Kickoff for a brand-new session; the store's start() already seeded the transcript.
  kickoff?: string
  onEvent?: (event: unknown, store: BaseChatRunState) => void
}

export function ChatHost({ useRun, useOpenSubscription, kickoff, onEvent }: ChatHostProps) {
  const running = useRun((s) => s.running)
  const sessionId = useRun((s) => s.sessionId)
  const lastSeq = useRun((s) => s.lastSeq)
  const status = useRun((s) => s.status)

  // Reattach-on-mount: a persisted running/awaiting session re-subscribes.
  const reattachedRef = useRef(false)
  useEffect(() => {
    if (reattachedRef.current) return
    reattachedRef.current = true
    const s = useRun.getState()
    if (s.sessionId && (s.status === 'running' || s.status === 'awaiting') && !s.running) {
      s.reattach()
    }
  }, [useRun])

  // kickoff is only sent while the transcript is fresh (status running, seq 0, one entry).
  const isFreshStart = status === 'running' && lastSeq === 0
  const subInput = useMemo<OpenInput | typeof skipToken>(
    () =>
      running && sessionId
        ? { sessionId, lastSeq, kickoff: isFreshStart ? kickoff : undefined }
        : skipToken,
    [running, sessionId, lastSeq, kickoff, isFreshStart],
  )

  useOpenSubscription(subInput, {
    onData: ({ seq, event }) => {
      const store = useRun.getState()
      store.bumpSeq(seq)
      const e = event as { type: string; text?: string; summary?: string; message?: string }
      switch (e.type) {
        case 'token':
          store.appendToken(e.text ?? '')
          break
        case 'tool':
          store.pushTool(e.summary ?? '')
          break
        case 'awaiting-input':
          store.flushTurn()
          store.setAwaiting(true)
          break
        case 'done':
          store.flushTurn()
          store.finish('done')
          break
        case 'error':
          store.finish('error')
          if (e.message) toast.error(e.message)
          break
        case 'aborted':
          store.finish('aborted')
          break
      }
      onEvent?.(event, useRun.getState())
    },
    onError: (error) => {
      useRun.getState().finish('error')
      toast.error(error.message)
    },
  })

  return null
}
```

- [ ] **Step 2: Typecheck web (expect stores not yet migrated)**

Run: `pnpm typecheck:web`
Expected: FAIL only where old stores/hosts still reference the removed `start`/`requestId` — resolved in Tasks 11-16.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ChatHost.tsx
git commit -m "feat(chat): generic ChatHost (reattach + seq dispatch)"
```

---

## Task 11: Persist the chatDrawer store

**Files:**
- Modify: `src/renderer/src/store/chatDrawer.ts`
- Test: `src/renderer/src/store/chatDrawer.persist.test.ts`

**Interfaces:**
- Produces: `useChatDrawer` gains `persist` (key `atlas-chat-drawer`) persisting `open`, `sessions`, `activeSessionId`, with a `mergePersistedChatDrawer(persisted, current)` sanitizer that drops unknown session types and keeps live actions.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/store/chatDrawer.persist.test.ts
import { describe, expect, it } from 'vitest'
import { type ChatDrawerState, mergePersistedChatDrawer } from './chatDrawer'

const base: ChatDrawerState = {
  open: false, sessions: [], activeSessionId: null,
  openSession: () => {}, closeSession: () => {}, setActive: () => {}, setOpen: () => {},
}

describe('mergePersistedChatDrawer', () => {
  it('keeps valid sessions and live actions', () => {
    const merged = mergePersistedChatDrawer(
      { open: true, activeSessionId: 'roadmap', sessions: [{ id: 'roadmap', type: 'roadmap', title: 'x' }] },
      base,
    )
    expect(merged.open).toBe(true)
    expect(merged.sessions).toHaveLength(1)
    expect(typeof merged.openSession).toBe('function')
  })
  it('drops sessions with unknown types', () => {
    const merged = mergePersistedChatDrawer(
      { sessions: [{ id: 'x', type: 'bogus', title: 'x' }] } as unknown, base,
    )
    expect(merged.sessions).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/renderer/src/store/chatDrawer.persist.test.ts`
Expected: FAIL — `mergePersistedChatDrawer` / exported `ChatDrawerState` not found.

- [ ] **Step 3: Add persistence to chatDrawer.ts**

Export the state interface, add the sanitizer, and wrap `create` with `persist` (mirror `ui.ts`):

```ts
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// ...existing ChatSessionType, ChatSession, DEFAULT_TITLES...

export interface ChatDrawerState {
  open: boolean
  sessions: ChatSession[]
  activeSessionId: string | null
  openSession: (s: { type: ChatSessionType; title?: string }) => void
  closeSession: (id: string) => void
  setActive: (id: string) => void
  setOpen: (open: boolean) => void
}

const VALID_TYPES: ChatSessionType[] = ['benchmark', 'roadmap', 'skillImprover', 'generalChat']

export function mergePersistedChatDrawer(persisted: unknown, current: ChatDrawerState): ChatDrawerState {
  const p = (persisted ?? {}) as Partial<ChatDrawerState>
  const sessions = Array.isArray(p.sessions)
    ? p.sessions.filter(
        (s): s is ChatSession =>
          !!s && typeof s.id === 'string' && VALID_TYPES.includes(s.type) && typeof s.title === 'string',
      )
    : []
  const activeSessionId =
    typeof p.activeSessionId === 'string' && sessions.some((s) => s.id === p.activeSessionId)
      ? p.activeSessionId
      : (sessions[0]?.id ?? null)
  return { ...current, open: Boolean(p.open) && sessions.length > 0, sessions, activeSessionId }
}

const noopStorage: Storage = {
  getItem: () => null, setItem: () => undefined, removeItem: () => undefined,
  clear: () => undefined, key: () => null, length: 0,
}
const storage = createJSONStorage<Pick<ChatDrawerState, 'open' | 'sessions' | 'activeSessionId'>>(() =>
  typeof localStorage !== 'undefined' ? localStorage : noopStorage,
)

export const useChatDrawer = create<ChatDrawerState>()(
  persist(
    (set) => ({
      // ...existing initial state + actions, unchanged...
    }),
    {
      name: 'atlas-chat-drawer',
      version: 1,
      storage,
      partialize: (s) => ({ open: s.open, sessions: s.sessions, activeSessionId: s.activeSessionId }),
      merge: (persisted, current) => mergePersistedChatDrawer(persisted, current),
    },
  ),
)
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/renderer/src/store/chatDrawer.persist.test.ts src/renderer/src/store/chatDrawer.test.ts`
Expected: PASS (existing chatDrawer.test.ts still green).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/chatDrawer.ts src/renderer/src/store/chatDrawer.persist.test.ts
git commit -m "feat(chat): persist drawer open/tabs across reload"
```

---

## Task 12: Migrate generalChat renderer (store + overlay + host)

**Files:**
- Rewrite: `src/renderer/src/store/generalChatRun.ts`
- Modify: `src/renderer/src/components/GeneralChatOverlay.tsx`
- Delete: `src/renderer/src/components/GeneralChatHost.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `createChatRunStore` (Task 9), `ChatHost` (Task 10), `generalChat.open/reply/cancel` (Task 5).
- Produces: `useGeneralChatRun = createChatRunStore('atlas-chat-run-general')`. Overlay uses `sessionId`+`status`+`awaitingInput` and calls `reply.mutate({ sessionId, text })`. App mounts `<ChatHost useRun={useGeneralChatRun} useOpenSubscription={trpc.generalChat.open.useSubscription} kickoff={firstMessage} />`.

- [ ] **Step 1: Rewrite the store as a factory instance**

Replace the entire body of `src/renderer/src/store/generalChatRun.ts`:

```ts
import { createChatRunStore } from '@renderer/store/createChatRunStore'
export const useGeneralChatRun = createChatRunStore('atlas-chat-run-general')
export type { ChatEntry as GeneralChatEntry } from '@renderer/store/createChatRunStore'
```

- [ ] **Step 2: Update the overlay to sessionId + reply**

In `GeneralChatOverlay.tsx`, replace `requestId` reads with `sessionId`, and the reply call. The kickoff message must be captured for the host — store the first message in the transcript (already done by `start`). Change:

```tsx
const sessionId = useGeneralChatRun((s) => s.sessionId)
// ...
const reply = trpc.generalChat.reply.useMutation()
const send = () => {
  const text = draft.trim()
  if (!text || !sessionId || !awaitingInput) return
  pushUserReply(text)
  reply.mutate({ sessionId, text })
  setDraft('')
}
```

`begin()` stays `startSession(text)` (mints sessionId + seeds transcript). The `status !== 'idle'` gate is unchanged. `awaitingInput` now also flips `status` to `'awaiting'` (Task 9), so `status !== 'running'` disabling checks become `!(status === 'running' || status === 'awaiting')` — simplify the composer's `disabled` to `!awaitingInput`.

- [ ] **Step 3: Mount ChatHost in App.tsx; delete the old host**

In `App.tsx` remove `import { GeneralChatHost }` and its `<GeneralChatHost />`, and add:

```tsx
import { ChatHost } from '@renderer/components/ChatHost'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { trpc } from '@renderer/lib/trpc'
// ...
const generalKickoff = useGeneralChatRun((s) => s.transcript[0]?.text)
// in JSX:
<ChatHost
  useRun={useGeneralChatRun}
  useOpenSubscription={trpc.generalChat.open.useSubscription}
  kickoff={generalKickoff}
/>
```

Delete `src/renderer/src/components/GeneralChatHost.tsx`.

- [ ] **Step 4: Update UnifiedChatDrawer cancel target for generalChat**

In `UnifiedChatDrawer.tsx`, the `generalChat` branches of `endSession`/`openGeneralChat` read `st.requestId`; change to `st.sessionId` and `generalCancel.mutate({ sessionId: st.sessionId })`. The streaming guard uses `st.awaitingInput`/`st.status` (now includes `'awaiting'`) — keep behaviour (do not interrupt an active stream).

- [ ] **Step 5: Typecheck web + run store test**

Run: `pnpm typecheck:web && pnpm vitest run src/renderer/src/store/createChatRunStore.test.ts`
Expected: `generalChat`-related type errors gone (roadmap/benchmark/skillImprover still error until their tasks).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/generalChatRun.ts src/renderer/src/components/GeneralChatOverlay.tsx src/renderer/src/components/UnifiedChatDrawer.tsx src/renderer/src/App.tsx
git rm src/renderer/src/components/GeneralChatHost.tsx
git commit -m "feat(chat): generalChat renderer on factory + ChatHost"
```

---

## Task 13: Migrate roadmap renderer

**Files:**
- Rewrite: `src/renderer/src/store/roadmapChatRun.ts`
- Modify: `src/renderer/src/components/RoadmapChatOverlay.tsx`, `UnifiedChatDrawer.tsx`, `App.tsx`
- Delete: `src/renderer/src/components/RoadmapChatHost.tsx`

**Interfaces:**
- Produces: `useRoadmapChatRun` = factory instance with a `savedItem` extra. Roadmap's `saved` event handled via `ChatHost`'s `onEvent`.

- [ ] **Step 1: Rebuild the store with a savedItem slice**

`createChatRunStore` covers the base; roadmap needs `savedItem`. Extend by composing a tiny wrapper store that holds `savedItem` separately, OR add `savedItem` handling in `onEvent` by keeping a second small zustand store. Simplest: a dedicated small store for `savedItem`:

```ts
// src/renderer/src/store/roadmapChatRun.ts
import { createChatRunStore } from '@renderer/store/createChatRunStore'
import type { RoadmapItem } from '@shared/roadmap'
import { create } from 'zustand'

export const useRoadmapChatRun = createChatRunStore('atlas-chat-run-roadmap')

interface RoadmapSavedState { savedItem: RoadmapItem | null; setSaved: (i: RoadmapItem) => void; clearSaved: () => void }
export const useRoadmapSaved = create<RoadmapSavedState>((set) => ({
  savedItem: null,
  setSaved: (savedItem) => set({ savedItem }),
  clearSaved: () => set({ savedItem: null }),
}))
```

- [ ] **Step 2: Mount ChatHost with onEvent for `saved`; delete old host**

In `App.tsx`:

```tsx
<ChatHost
  useRun={useRoadmapChatRun}
  useOpenSubscription={trpc.roadmapChat.open.useSubscription}
  kickoff={useRoadmapChatRun((s) => s.transcript[0]?.text)}
  onEvent={(event) => {
    const e = event as { type: string; item?: RoadmapItem }
    if (e.type === 'saved' && e.item) useRoadmapSaved.getState().setSaved(e.item)
  }}
/>
```

- [ ] **Step 3: Update RoadmapChatOverlay** to read `sessionId`/`status`/`awaitingInput` from `useRoadmapChatRun` and `savedItem` from `useRoadmapSaved`; `reply.mutate({ sessionId, text })`; the idea-input `begin()` calls `useRoadmapChatRun.getState().start(idea)` and `useRoadmapSaved.getState().clearSaved()`. Update `UnifiedChatDrawer.tsx` roadmap branch to `sessionId` + `roadmapCancel.mutate({ sessionId })` + `useRoadmapSaved.getState().clearSaved()` on close.

- [ ] **Step 4: Typecheck web**

Run: `pnpm typecheck:web`
Expected: roadmap errors gone.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/roadmapChatRun.ts src/renderer/src/components/RoadmapChatOverlay.tsx src/renderer/src/components/UnifiedChatDrawer.tsx src/renderer/src/App.tsx
git rm src/renderer/src/components/RoadmapChatHost.tsx
git commit -m "feat(chat): roadmap renderer on factory + ChatHost"
```

---

## Task 14: Migrate benchmark renderer

**Files:**
- Rewrite: `src/renderer/src/store/benchmarkChatRun.ts`
- Modify: `src/renderer/src/components/BenchmarkChatOverlay.tsx`, `UnifiedChatDrawer.tsx`, `App.tsx`, `src/renderer/src/pages/Productivity.tsx:2111`
- Delete: `src/renderer/src/components/BenchmarkChatHost.tsx`

**Interfaces:**
- Produces: `useBenchmarkChatRun` = factory instance with a `batchId` extra (the kickoff). `start(batchId)` must both mint the session and remember `batchId` so `ChatHost` sends it as `kickoff`.

- [ ] **Step 1: Read the current benchmark store + overlay**

Run: `cat src/renderer/src/store/benchmarkChatRun.ts; sed -n '1,60p' src/renderer/src/components/BenchmarkChatOverlay.tsx`
Note that `start(batchId)` currently seeds context (the batchId is the discussion subject, not a user message).

- [ ] **Step 2: Rebuild the store with a batchId slice**

Benchmark's kickoff is the `batchId`, not a typed user message. Keep a small companion store for it:

```ts
// src/renderer/src/store/benchmarkChatRun.ts
import { createChatRunStore } from '@renderer/store/createChatRunStore'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const useBenchmarkChatRun = createChatRunStore('atlas-chat-run-benchmark')

const noopStorage: Storage = {
  getItem: () => null, setItem: () => undefined, removeItem: () => undefined,
  clear: () => undefined, key: () => null, length: 0,
}
interface BenchmarkChatContext { batchId: string | null; setBatch: (id: string) => void; clearBatch: () => void }
export const useBenchmarkChatContext = create<BenchmarkChatContext>()(
  persist(
    (set) => ({ batchId: null, setBatch: (batchId) => set({ batchId }), clearBatch: () => set({ batchId: null }) }),
    {
      name: 'atlas-chat-run-benchmark-ctx',
      version: 1,
      storage: createJSONStorage(() => (typeof localStorage !== 'undefined' ? localStorage : noopStorage)),
      partialize: (s) => ({ batchId: s.batchId }),
    },
  ),
)
```

- [ ] **Step 3: Update the trigger at `Productivity.tsx:2111`**

```tsx
// was: useBenchmarkChatRun.getState().start(analysis.data?.batchId ?? '')
const batchId = analysis.data?.batchId ?? ''
useBenchmarkChatContext.getState().setBatch(batchId)
useBenchmarkChatRun.getState().start(batchId) // seeds sessionId; transcript[0] holds batchId as a marker
useChatDrawer.getState().openSession({ type: 'benchmark' })
```

- [ ] **Step 4: Mount ChatHost with the batchId as kickoff; delete old host**

In `App.tsx`:

```tsx
<ChatHost
  useRun={useBenchmarkChatRun}
  useOpenSubscription={trpc.benchmarkChat.open.useSubscription}
  kickoff={useBenchmarkChatContext((s) => s.batchId) ?? undefined}
/>
```

(The benchmark transcript's first entry is the batchId marker; the backend seed is rebuilt from `kickoff` = batchId, per Task 7.)

- [ ] **Step 5: Update BenchmarkChatOverlay + UnifiedChatDrawer** to `sessionId` + `benchCancel.mutate({ sessionId })` + `useBenchmarkChatContext.getState().clearBatch()` on close. The overlay's intro text (batch subject) reads from `useBenchmarkChatContext`.

- [ ] **Step 6: Typecheck web**

Run: `pnpm typecheck:web`
Expected: benchmark errors gone.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/benchmarkChatRun.ts src/renderer/src/components/BenchmarkChatOverlay.tsx src/renderer/src/components/UnifiedChatDrawer.tsx src/renderer/src/App.tsx src/renderer/src/pages/Productivity.tsx
git rm src/renderer/src/components/BenchmarkChatHost.tsx
git commit -m "feat(chat): benchmark renderer on factory + ChatHost"
```

---

## Task 15: Migrate skillImprover renderer (reattach-only)

**Files:**
- Rewrite: `src/renderer/src/store/skillImproverRun.ts`
- Modify: `src/renderer/src/components/SkillImproverOverlay.tsx`, `UnifiedChatDrawer.tsx`, `App.tsx`, `src/renderer/src/pages/Skills.tsx:95`
- Delete: `src/renderer/src/components/SkillImproverHost.tsx`

**Interfaces:**
- Produces: `useSkillImproverRun` = factory instance + a companion store for `report`/`skillId`/finalize status. `ChatHost.onEvent` handles `report` and the token/duration payloads on `done`/`aborted`. Kickoff = `skillId`. No app-restart resume (backend `resumable:false`).

- [ ] **Step 1: Read current improver store + overlay**

Run: `cat src/renderer/src/store/skillImproverRun.ts; sed -n '1,80p' src/renderer/src/components/SkillImproverOverlay.tsx`
Note `report`, `accept`/`reject` wiring, and the `skillId` used as start arg.

- [ ] **Step 2: Rebuild store + companion**

```ts
// src/renderer/src/store/skillImproverRun.ts
import { createChatRunStore } from '@renderer/store/createChatRunStore'
import type { ImproverReport } from '@shared/skillImprover'
import { create } from 'zustand'

export const useSkillImproverRun = createChatRunStore('atlas-chat-run-improver')

interface ImproverExtraState {
  skillId: string | null
  report: ImproverReport | null
  setSkill: (id: string) => void
  setReport: (r: ImproverReport) => void
  clear: () => void
}
export const useSkillImproverExtra = create<ImproverExtraState>((set) => ({
  skillId: null,
  report: null,
  setSkill: (skillId) => set({ skillId }),
  setReport: (report) => set({ report }),
  clear: () => set({ skillId: null, report: null }),
}))
```

- [ ] **Step 3: Update the trigger at `Skills.tsx:95`** to set skillId + start + open:

```tsx
useSkillImproverExtra.getState().setSkill(skillId)
useSkillImproverRun.getState().start(skillId) // transcript[0] = skillId marker
useChatDrawer.getState().openSession({ type: 'skillImprover', title: skillId })
```

- [ ] **Step 4: Mount ChatHost with onEvent for report; delete old host**

```tsx
<ChatHost
  useRun={useSkillImproverRun}
  useOpenSubscription={trpc.skillImprover.open.useSubscription}
  kickoff={useSkillImproverExtra((s) => s.skillId) ?? undefined}
  onEvent={(event) => {
    const e = event as { type: string; report?: ImproverReport }
    if (e.type === 'report' && e.report) useSkillImproverExtra.getState().setReport(e.report)
  }}
/>
```

- [ ] **Step 5: Update SkillImproverOverlay + UnifiedChatDrawer** — read `sessionId`/`status` from `useSkillImproverRun`, `report`/`skillId` from `useSkillImproverExtra`; `accept`/`reject`/`cancel` mutations target `{ sessionId }`; on close clear the extra store. Because backend `resumable:false`, an app-restart mount will receive `aborted` from the registry (via `ChatHost`) and the composer stays closed — no code change needed beyond that automatic path.

- [ ] **Step 6: Typecheck web + full lint**

Run: `pnpm typecheck:web && pnpm lint`
Expected: PASS (only the pre-existing Galaxy3D warnings remain).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/store/skillImproverRun.ts src/renderer/src/components/SkillImproverOverlay.tsx src/renderer/src/components/UnifiedChatDrawer.tsx src/renderer/src/App.tsx src/renderer/src/pages/Skills.tsx
git rm src/renderer/src/components/SkillImproverHost.tsx
git commit -m "feat(chat): skillImprover renderer on factory + ChatHost (reattach-only)"
```

---

## Task 16: Full verification + manual resume check

**Files:** none (verification only). Uses the `/run` skill / `pnpm dev`.

- [ ] **Step 1: Full static gate**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS (pre-existing Galaxy3D biome warnings only; no errors).

- [ ] **Step 2: Manual — renderer refresh mid-reply (main alive)**

1. `pnpm dev`. Open the general chat, send a message, and while the reply is streaming press Cmd+R.
2. Expected: drawer reopens with the same transcript; the in-flight reply continues streaming (the seq buffer replays the gap); the composer re-enables when the turn ends.
   - If a NODE_MODULE_VERSION error appears on boot, run electron-rebuild (Global Constraints) and retry.

- [ ] **Step 3: Manual — full app restart (main dead)**

1. Send a message, wait for the reply to finish (composer enabled), then quit and relaunch the app.
2. Expected: drawer reopens with the transcript; sending a new message continues with full context (backend `resume` reloaded the on-disk session).

- [ ] **Step 4: Manual — skillImprover restart is safe**

1. Start a skill-improver session, then quit and relaunch.
2. Expected: the transcript shows read-only; the session is reported ended (no unsafe workspace rehydration); starting a fresh improver works.

- [ ] **Step 5: Manual — tab close tears down**

1. Open a chat, close its tab (×). Expected: the backend run is cancelled, the store resets, and reopening starts fresh.

- [ ] **Step 6: Commit any doc/verification notes (if changed) and stop**

```bash
git add -A
git commit -m "chore(chat): verification notes for resume" || true
```

---

## Self-review

- **Spec coverage:** stable session id (Tasks 9,12-15) ✓; registry outliving subscriptions + buffer/seq replay (Task 4) ✓; SDK sessionId/resume wiring (Task 3) ✓; `open` tRPC contract (Tasks 5-8) ✓; renderer persistence + reattach (Tasks 9-11) ✓; generic store/host (Tasks 9,10) ✓; all four migrated (Tasks 12-15) ✓; skillImprover reattach-only (Tasks 8,15) ✓; empty-mailbox-resume validation (Task 3 impl + Task 16 Step 2/3) ✓; buffer cap (Task 4 `BUFFER_CAP`) ✓; benchmark seed rebuild from batchId (Tasks 7,14) ✓.
- **Type consistency:** `ResumableRun`, `StartResumableChatOptions`, `OpenParams`, `SeqEnvelope<E>`, `BaseChatEvent`, `BaseChatRunState`, `ChatHostProps` names are used identically across the tasks that define and consume them. `open`/`reply`/`cancel` procedure names and `{sessionId,lastSeq,kickoff?}` / `{sessionId,text}` / `{sessionId}` input shapes match between Tasks 5-8 (backend) and Tasks 10,12-15 (renderer).
- **Open validation item (carried from spec):** if empty-mailbox `resume` (Task 3) does not idle cleanly under the real SDK, Task 16 Step 3 will surface it; fallback is to send a benign no-op continuation on resume or gate the composer until the first reply reopens the mailbox — apply in `startResumableChat` if observed.
