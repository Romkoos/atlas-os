# General Chat (generalChat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a general free-form chat with the agent as a new `generalChat` singleton session type in the UnifiedChatDrawer, opened by the FAB (when no sessions exist) and a new "+" button.

**Architecture:** A new `generalChat` backend (tRPC subscription router + headless-Claude run service, mirroring the benchmark chat) streams tokens to a new `generalChatRun` store fed by an always-mounted `GeneralChatHost`. A headless `GeneralChatOverlay` body renders inside the drawer; the drawer gains the type, an `openGeneralChat()` entry, a "+" button, and FAB-when-empty behavior.

**Tech Stack:** Electron, tRPC subscriptions, `@anthropic-ai/claude-agent-sdk`, React 18, Zustand, vitest, plain CSS.

## Global Constraints

- All UI strings in English. Import aliases: `@main/...`, `@renderer/...`, `@shared/...`.
- Styling in `src/renderer/src/index.css` with custom classes (NOT Tailwind).
- Do NOT modify the benchmark/roadmap/skillImprover backends, hosts, or store lifecycles.
- `generalChat` is a singleton: `id === type` in the drawer.
- Read-only agent tools only: `['Read', 'Grep', 'Glob']`, `permissionMode: 'bypassPermissions'`.
- Commit steps are opt-in — skip if the running policy forbids commits; leave changes in the working tree.
- Typecheck: `pnpm typecheck`. Tests: `pnpm test`. Build: `pnpm build`. Lint: `pnpm lint` (9 pre-existing `noExplicitAny` warnings in Galaxy3D.tsx/d3-force-3d.d.ts are unrelated and OK).

---

### Task 1: Backend event type + seed + run service

**Files:**
- Modify: `src/shared/ipc-events.ts`
- Create: `src/main/services/generalChat/seed.ts`
- Test: `src/main/services/generalChat/seed.test.ts`
- Create: `src/main/services/generalChat/run.ts`

**Interfaces:**
- Produces:
  - `GeneralChatEvent` (union) in `@shared/ipc-events`.
  - `buildGeneralChatSeed(firstMessage: string): string`.
  - `startGeneralChat(opts: { requestId: string; seed: string; model: string; repoRoot: string; emit: (e: GeneralChatEvent) => void }): { reply: (t: string) => void; cancel: () => void; done: Promise<void> }` and type `GeneralChatRun`.

- [ ] **Step 1: Add the event type**

In `src/shared/ipc-events.ts`, add next to `BenchmarkChatEvent`:

```ts
// Events streamed from main → renderer during a general free-form chat.
export type GeneralChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; summary: string }
  | { type: 'awaiting-input' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
```

- [ ] **Step 2: Write the failing seed test**

Create `src/main/services/generalChat/seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildGeneralChatSeed } from './seed'

describe('buildGeneralChatSeed', () => {
  it('frames the assistant and includes the user message', () => {
    const seed = buildGeneralChatSeed('what does this repo do?')
    expect(seed).toContain('atlas-os')
    expect(seed).toContain('read-only')
    expect(seed).toContain('what does this repo do?')
  })
})
```

- [ ] **Step 3: Run it to verify failure**

Run: `pnpm test -- src/main/services/generalChat/seed.test.ts`
Expected: FAIL — cannot resolve `./seed`.

- [ ] **Step 4: Write the seed**

Create `src/main/services/generalChat/seed.ts`:

```ts
// The opening user message for a general chat session. Frames the assistant and
// its read-only repo access, then appends the user's first message.
export function buildGeneralChatSeed(firstMessage: string): string {
  return [
    'You are a general-purpose assistant embedded in the atlas-os desktop app.',
    'You have read-only access to this repository (Read, Grep, Glob) if code context helps; you cannot modify files.',
    'Answer conversationally. The user’s first message:',
    '',
    firstMessage,
  ].join('\n')
}
```

- [ ] **Step 5: Run the seed test to verify it passes**

Run: `pnpm test -- src/main/services/generalChat/seed.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the run service**

Create `src/main/services/generalChat/run.ts` (a direct adaptation of `src/main/services/benchmarkChat/run.ts`):

```ts
// src/main/services/generalChat/run.ts
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@main/logger'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { createMailbox, type Mailbox } from '@main/services/skillImprover/mailbox'
import type { GeneralChatEvent } from '@shared/ipc-events'

// Read-only tools: the chat may inspect code but must never mutate the repo.
const CHAT_TOOLS = ['Read', 'Grep', 'Glob']

export interface GeneralChatRun {
  reply: (text: string) => void
  cancel: () => void
  done: Promise<void>
}

export interface StartGeneralChatOptions {
  requestId: string
  seed: string
  model: string
  repoRoot: string
  emit: (event: GeneralChatEvent) => void
}

// Interactive general chat session. Streaming-input mode: the session stays open
// across turns until the mailbox is closed by cancel.
export function startGeneralChat(opts: StartGeneralChatOptions): GeneralChatRun {
  const controller = new AbortController()
  let queryRef: Query | null = null
  let mailbox: Mailbox | null = null
  let stopped = false

  const done = (async (): Promise<void> => {
    mailbox = createMailbox(opts.seed)
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt: mailbox.stream,
      options: {
        model: opts.model,
        allowedTools: CHAT_TOOLS,
        permissionMode: 'bypassPermissions',
        settingSources: ['user', 'project'],
        includePartialMessages: true,
        cwd: opts.repoRoot,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    queryRef = q

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          opts.emit({ type: 'token', text: event.delta.text })
        }
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            opts.emit({ type: 'tool', name: block.name, summary: summarizeTool(block) })
          }
        }
      } else if (message.type === 'result') {
        if (stopped) continue
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
    logger.error('General chat failed', message)
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

- [ ] **Step 7: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the run service compiles; not imported anywhere yet).

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc-events.ts src/main/services/generalChat/
git commit -m "feat(general-chat): add GeneralChatEvent, seed, and run service"
```

---

### Task 2: tRPC router + registration

**Files:**
- Create: `src/main/trpc/routers/generalChat.ts`
- Modify: `src/main/trpc/router.ts`

**Interfaces:**
- Consumes: `startGeneralChat`/`GeneralChatRun` (Task 1), `buildGeneralChatSeed` (Task 1), `GeneralChatEvent` (Task 1).
- Produces: `generalChatRouter` exposing `start({ requestId, message })` subscription, `reply({ requestId, text })`, `cancel({ requestId })`; registered as `appRouter.generalChat`.

- [ ] **Step 1: Write the router**

Create `src/main/trpc/routers/generalChat.ts` (adapted from `roadmapChat.ts`, without the proposal/save path):

```ts
import { jobRegistry } from '@main/services/jobs/registry'
import { startGeneralChat, type GeneralChatRun } from '@main/services/generalChat/run'
import { buildGeneralChatSeed } from '@main/services/generalChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { GeneralChatEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { app } from 'electron'
import { z } from 'zod'

const runs = new Map<string, GeneralChatRun>()

export const generalChatRouter = router({
  start: publicProcedure
    .input(z.object({ requestId: z.string().min(1), message: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<GeneralChatEvent>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const repoRoot = app.getAppPath()
        const seed = buildGeneralChatSeed(input.message)
        const job = jobRegistry.register({
          kind: 'general.chat',
          label: 'General chat',
          model,
          abort: () => runs.get(input.requestId)?.cancel(),
        })

        const run = startGeneralChat({
          requestId: input.requestId,
          seed,
          model,
          repoRoot,
          emit: (event) => {
            if (event.type === 'done') job.finish('done')
            if (event.type === 'error' || event.type === 'aborted') job.finish('error')
            emit.next(event)
          },
        })
        runs.set(input.requestId, run)

        return () => {
          const r = runs.get(input.requestId)
          if (r) {
            r.cancel()
            runs.delete(input.requestId)
          }
          job.finish('error')
        }
      }),
    ),

  reply: publicProcedure
    .input(z.object({ requestId: z.string().min(1), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.reply(input.text)
      return { ok: Boolean(run) }
    }),

  cancel: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.cancel()
      runs.delete(input.requestId)
      return { ok: Boolean(run) }
    }),
})
```

- [ ] **Step 2: Register the router**

In `src/main/trpc/router.ts`, add the import next to `roadmapChatRouter`:

```ts
import { generalChatRouter } from '@main/trpc/routers/generalChat'
```

and add the entry inside the `router({ ... })` object (after `roadmapChat: roadmapChatRouter,`):

```ts
  generalChat: generalChatRouter,
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. `trpc.generalChat.start/reply/cancel` are now available on the client type.

- [ ] **Step 4: Commit**

```bash
git add src/main/trpc/routers/generalChat.ts src/main/trpc/router.ts
git commit -m "feat(general-chat): add generalChat tRPC router"
```

---

### Task 3: Renderer store `generalChatRun`

**Files:**
- Create: `src/renderer/src/store/generalChatRun.ts`

**Interfaces:**
- Produces: `useGeneralChatRun` zustand store with state `{ running, requestId, message, transcript, streaming, awaitingInput, status }` and actions `start(message)`, `appendToken(text)`, `pushTool(summary)`, `pushUserReply(text)`, `flushTurn()`, `setAwaiting(v)`, `finish(status)`, `reset()`. `GeneralChatEntry = { kind: 'assistant' | 'tool' | 'user'; text: string }`.

- [ ] **Step 1: Create the store**

Create `src/renderer/src/store/generalChatRun.ts`:

```ts
import { create } from 'zustand'

export interface GeneralChatEntry {
  kind: 'assistant' | 'tool' | 'user'
  text: string
}

// Lives OUTSIDE any page so the chat survives tab switches; the subscription is
// hosted at App level (GeneralChatHost).
interface GeneralChatState {
  running: boolean
  requestId: string | null
  message: string | null
  transcript: GeneralChatEntry[]
  streaming: string
  awaitingInput: boolean
  status: 'idle' | 'running' | 'done' | 'error' | 'aborted'

  start: (message: string) => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

export const useGeneralChatRun = create<GeneralChatState>((set) => ({
  running: false,
  requestId: null,
  message: null,
  transcript: [],
  streaming: '',
  awaitingInput: false,
  status: 'idle',

  start: (message) =>
    set({
      running: true,
      requestId: crypto.randomUUID(),
      message,
      transcript: [{ kind: 'user', text: message }],
      streaming: '',
      awaitingInput: false,
      status: 'running',
    }),

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
    set((s) => ({
      transcript: [...s.transcript, { kind: 'user', text }],
      awaitingInput: false,
    })),

  setAwaiting: (v) => set({ awaitingInput: v }),

  finish: (status) => set({ running: false, awaitingInput: false, status }),

  reset: () =>
    set({
      running: false,
      requestId: null,
      message: null,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      status: 'idle',
    }),
}))
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/store/generalChatRun.ts
git commit -m "feat(general-chat): add generalChatRun store"
```

---

### Task 4: `GeneralChatHost` + mount in App

**Files:**
- Create: `src/renderer/src/components/GeneralChatHost.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `trpc.generalChat.start` (Task 2), `useGeneralChatRun` (Task 3).
- Produces: `GeneralChatHost` (renders null), mounted once at App root.

- [ ] **Step 1: Create the host**

Create `src/renderer/src/components/GeneralChatHost.tsx` (adapted from `RoadmapChatHost.tsx`, no saved path):

```tsx
import { trpc } from '@renderer/lib/trpc'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { skipToken } from '@tanstack/react-query'
import { useMemo } from 'react'
import { toast } from 'sonner'

// Always-mounted host for the general-chat subscription. Living above the page
// switch means leaving a tab does not unsubscribe → the session keeps going.
export function GeneralChatHost() {
  const running = useGeneralChatRun((s) => s.running)
  const requestId = useGeneralChatRun((s) => s.requestId)
  const message = useGeneralChatRun((s) => s.message)
  const appendToken = useGeneralChatRun((s) => s.appendToken)
  const flushTurn = useGeneralChatRun((s) => s.flushTurn)
  const pushTool = useGeneralChatRun((s) => s.pushTool)
  const setAwaiting = useGeneralChatRun((s) => s.setAwaiting)
  const finish = useGeneralChatRun((s) => s.finish)

  const subInput = useMemo(
    () => (running && requestId && message ? { requestId, message } : skipToken),
    [running, requestId, message],
  )

  trpc.generalChat.start.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'token':
          appendToken(event.text)
          break
        case 'tool':
          pushTool(event.summary)
          break
        case 'awaiting-input':
          flushTurn()
          setAwaiting(true)
          break
        case 'done':
          flushTurn()
          finish('done')
          break
        case 'error':
          finish('error')
          toast.error(event.message)
          break
        case 'aborted':
          finish('aborted')
          break
      }
    },
    onError: (error) => {
      finish('error')
      toast.error(error.message)
    },
  })

  return null
}
```

- [ ] **Step 2: Mount it in App.tsx**

In `src/renderer/src/App.tsx`, add the import next to the other host imports:

```tsx
import { GeneralChatHost } from '@renderer/components/GeneralChatHost'
```

and mount it alongside the other hosts (after `<RoadmapChatHost />`):

```tsx
      <RoadmapChatHost />
      <GeneralChatHost />
      <UnifiedChatDrawer />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/GeneralChatHost.tsx src/renderer/src/App.tsx
git commit -m "feat(general-chat): mount always-on GeneralChatHost subscription"
```

---

### Task 5: `GeneralChatOverlay` headless body

**Files:**
- Create: `src/renderer/src/components/GeneralChatOverlay.tsx`

**Interfaces:**
- Consumes: `useGeneralChatRun` (Task 3), `trpc.generalChat.reply` (Task 2). Reuses existing `.rm-chat-body`/`.rm-chat-intro`/`.rm-chat-log`/`.rm-chat-foot`/`.rm-chat-entry`/`.rm-chat-intro-foot`/`.rm-field-label`/`.rm-chat-hint` CSS classes.
- Produces: `GeneralChatOverlay()` — no props; intro (type first message → `start`) then transcript + reply footer.

- [ ] **Step 1: Create the body**

Create `src/renderer/src/components/GeneralChatOverlay.tsx`:

```tsx
import { trpc } from '@renderer/lib/trpc'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useEffect, useRef, useState } from 'react'

// Body of the general chat session, rendered inside UnifiedChatDrawer. Reads the
// App-level store, so the session survives tab switches / drawer collapse (the
// subscription lives in GeneralChatHost). Close/stop is owned by the drawer.
export function GeneralChatOverlay() {
  const status = useGeneralChatRun((s) => s.status)
  const requestId = useGeneralChatRun((s) => s.requestId)
  const transcript = useGeneralChatRun((s) => s.transcript)
  const streaming = useGeneralChatRun((s) => s.streaming)
  const awaitingInput = useGeneralChatRun((s) => s.awaitingInput)
  const startSession = useGeneralChatRun((s) => s.start)
  const pushUserReply = useGeneralChatRun((s) => s.pushUserReply)

  const reply = trpc.generalChat.reply.useMutation()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const started = status !== 'idle'

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  const begin = () => {
    const text = draft.trim()
    if (!text) return
    startSession(text)
    setDraft('')
  }

  const send = () => {
    const text = draft.trim()
    if (!text || !requestId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ requestId, text })
    setDraft('')
  }

  return (
    <div className="rm-chat-body">
      {!started ? (
        <div className="rm-chat-intro">
          <span className="rm-field-label">New chat</span>
          <textarea
            className="input"
            rows={5}
            value={draft}
            placeholder="Ask anything…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                begin()
              }
            }}
            // biome-ignore lint/a11y/noAutofocus: focus the message field when a new chat opens
            autoFocus
          />
          <div className="rm-chat-hint">
            The assistant has read-only access to this repo. ⌘↵ to send.
          </div>
          <div className="rm-chat-intro-foot">
            <button type="button" className="btn primary" onClick={begin} disabled={!draft.trim()}>
              start chat
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="rm-chat-log" ref={logRef}>
            {transcript.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only; no stable id
              <div key={i} className={`rm-chat-entry ${e.kind}`}>
                {e.kind === 'tool' ? `· ${e.text}` : e.text}
              </div>
            ))}
            {streaming ? <div className="rm-chat-entry assistant">{streaming}</div> : null}
          </div>
          <div className="rm-chat-foot">
            <textarea
              className="input"
              rows={2}
              value={draft}
              placeholder={awaitingInput ? 'Reply…' : 'Assistant is thinking…'}
              disabled={!awaitingInput || status !== 'running'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button
              type="button"
              className="btn primary"
              disabled={!awaitingInput || status !== 'running'}
              onClick={send}
            >
              send
            </button>
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (component compiles; not rendered yet).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/GeneralChatOverlay.tsx
git commit -m "feat(general-chat): add headless GeneralChatOverlay body"
```

---

### Task 6: Add `generalChat` to the chatDrawer store

**Files:**
- Modify: `src/renderer/src/store/chatDrawer.ts`
- Test: `src/renderer/src/store/chatDrawer.test.ts`

**Interfaces:**
- Produces: `ChatSessionType` now includes `'generalChat'`; `DEFAULT_TITLES.generalChat = 'chat'`.

- [ ] **Step 1: Add the failing test**

Append to `src/renderer/src/store/chatDrawer.test.ts`:

```ts
describe('useChatDrawer generalChat', () => {
  it('opens a generalChat tab with the default "chat" title', () => {
    useChatDrawer.getState().openSession({ type: 'generalChat' })
    const s = useChatDrawer.getState()
    expect(s.sessions.map((x) => x.id)).toEqual(['generalChat'])
    expect(s.sessions[0].title).toBe('chat')
    expect(s.activeSessionId).toBe('generalChat')
  })
})
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm test -- src/renderer/src/store/chatDrawer.test.ts`
Expected: FAIL — `'generalChat'` is not assignable to `ChatSessionType`.

- [ ] **Step 3: Extend the type + default titles**

In `src/renderer/src/store/chatDrawer.ts`, change the union:

```ts
export type ChatSessionType = 'benchmark' | 'roadmap' | 'skillImprover' | 'generalChat'
```

and add the default title (extend the existing map):

```ts
const DEFAULT_TITLES: Record<ChatSessionType, string> = {
  benchmark: 'discuss results',
  roadmap: 'idea incubator',
  skillImprover: 'improver',
  generalChat: 'chat',
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/renderer/src/store/chatDrawer.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/chatDrawer.ts src/renderer/src/store/chatDrawer.test.ts
git commit -m "feat(general-chat): add generalChat session type to chatDrawer"
```

Note: after this task the drawer's `endSession` `else` branch temporarily also matches `generalChat` (mapping it to the skill-improver store). This is inert — no code path opens a `generalChat` tab until Task 7 wires the entry points and fixes `endSession`.

---

### Task 7: Wire the drawer — body, endSession, "+" button, FAB, CSS

**Files:**
- Modify: `src/renderer/src/components/UnifiedChatDrawer.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: `GeneralChatOverlay` (Task 5), `useGeneralChatRun` (Task 3), `trpc.generalChat.cancel` (Task 2), `useChatDrawer.openSession`, `ChatSessionType` incl. `generalChat` (Task 6).
- Produces: drawer renders/ends/starts the general chat; FAB creates a fresh chat when empty; a "+" button opens/refreshes the general chat.

- [ ] **Step 1: Update imports**

In `src/renderer/src/components/UnifiedChatDrawer.tsx`, add these imports (keep grouped order):

```tsx
import { GeneralChatOverlay } from '@renderer/components/GeneralChatOverlay'
```
```tsx
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
```

and change the lucide import to include `Plus`:

```tsx
import { MessageSquare, Plus, X } from 'lucide-react'
```

- [ ] **Step 2: Select `openSession`, drop `toggle`, add the cancel mutation**

Replace the `toggle` selector line:

```tsx
  const toggle = useChatDrawer((s) => s.toggle)
```

with:

```tsx
  const openSession = useChatDrawer((s) => s.openSession)
```

Add the general cancel mutation next to the others:

```tsx
  const benchCancel = trpc.benchmarkChat.cancel.useMutation()
  const roadmapCancel = trpc.roadmapChat.cancel.useMutation()
  const skillCancel = trpc.skillImprover.cancel.useMutation()
  const generalCancel = trpc.generalChat.cancel.useMutation()
```

- [ ] **Step 3: Add the fourth `endSession` branch**

Replace the current `endSession` (`if benchmark / else if roadmap / else <skillImprover>`) with the explicit four-branch version:

```tsx
  const endSession = (type: ChatSessionType) => {
    if (type === 'benchmark') {
      const st = useBenchmarkChatRun.getState()
      if (st.requestId && st.running) benchCancel.mutate({ requestId: st.requestId })
      st.reset()
    } else if (type === 'roadmap') {
      const st = useRoadmapChatRun.getState()
      if (st.requestId && st.running) roadmapCancel.mutate({ requestId: st.requestId })
      st.reset()
    } else if (type === 'skillImprover') {
      const st = useSkillImproverRun.getState()
      if (st.requestId && st.running) skillCancel.mutate({ requestId: st.requestId })
      st.reset()
    } else {
      const st = useGeneralChatRun.getState()
      if (st.requestId && st.running) generalCancel.mutate({ requestId: st.requestId })
      st.reset()
    }
    closeSession(type) // id === type
  }
```

- [ ] **Step 4: Add `openGeneralChat` and use it in the FAB**

Add this helper right after `endSession` (before the `const active = …` line):

```tsx
  // FAB-when-empty and the "+" button both land here. Start a fresh chat unless
  // the model is actively streaming (running && !awaitingInput) — then just
  // focus so we never interrupt an in-flight response. Resetting also cancels
  // the open server run.
  const openGeneralChat = () => {
    const st = useGeneralChatRun.getState()
    const streamingNow = st.running && !st.awaitingInput
    if (st.status !== 'idle' && !streamingNow) {
      if (st.requestId) generalCancel.mutate({ requestId: st.requestId })
      st.reset()
    }
    openSession({ type: 'generalChat' })
  }
```

Change the FAB `onClick` from `onClick={toggle}` to:

```tsx
        onClick={() => (sessions.length === 0 ? openGeneralChat() : setOpen(true))}
```

- [ ] **Step 5: Add the "+" button and the generalChat body branch**

In the `.chat-drawer-tabs` header, add a "+" button immediately before the `.chat-drawer-collapse` button:

```tsx
          <button
            type="button"
            className="chat-drawer-new"
            aria-label="New chat"
            onClick={openGeneralChat}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            className="chat-drawer-collapse"
            aria-label="Collapse chat"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
```

Add the generalChat body branch inside `.chat-drawer-body`:

```tsx
        <div className="chat-drawer-body">
          {active?.type === 'benchmark' ? <BenchmarkChatOverlay /> : null}
          {active?.type === 'roadmap' ? <RoadmapChatOverlay /> : null}
          {active?.type === 'skillImprover' ? <SkillImproverOverlay /> : null}
          {active?.type === 'generalChat' ? <GeneralChatOverlay /> : null}
        </div>
```

- [ ] **Step 6: Add the "+" button CSS**

In `src/renderer/src/index.css`, immediately after the `.chat-drawer-collapse:hover { … }` rule, add:

```css
  .chat-drawer-new {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 0;
    padding: 4px;
    color: var(--fg-3);
    cursor: pointer;
  }
  .chat-drawer-new:hover {
    color: var(--fg);
  }
```

- [ ] **Step 7: Typecheck + build + lint**

Run: `pnpm typecheck`
Expected: PASS (no unused `toggle`; all new symbols resolve).

Run: `pnpm build`
Expected: PASS.

Run: `pnpm lint`
Expected: PASS (only the 9 pre-existing unrelated warnings).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/components/UnifiedChatDrawer.tsx src/renderer/src/index.css
git commit -m "feat(general-chat): drawer body, + button, and FAB-opens-fresh-chat"
```

---

### Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: `chatDrawer.test.ts` and `generalChat/seed.test.ts` pass. The only failures should be the pre-existing `src/main/services/graph/store.test.ts` better-sqlite3 ABI mismatch under plain Node — unrelated to this branch.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Drive the app (`/run` or `pnpm dev`) and confirm:**

- With no chat sessions open, clicking the FAB opens the drawer on a fresh `chat` tab showing the "New chat" intro.
- Typing a first message + "start chat" (or ⌘↵) streams an assistant reply; a follow-up reply works.
- The "+" button opens/focuses the general chat: from a finished/idle chat it starts fresh; while the model is actively streaming it just focuses (does not interrupt).
- Benchmark, roadmap, skillImprover, and generalChat can all be open as tabs and switch correctly.
- The generalChat tab's `×` cancels a running chat and removes the tab; closing the last tab hides the drawer.

- [ ] **Step 4: Commit any fixes surfaced by verification** (skip if none)

```bash
git add -A
git commit -m "fix(general-chat): address issues found during verification"
```

---

## Self-Review

**Spec coverage:**
- `GeneralChatEvent` + seed + run service → Task 1. ✓
- Router + registration → Task 2. ✓
- `generalChatRun` store → Task 3. ✓
- `GeneralChatHost` + App mount → Task 4. ✓
- `GeneralChatOverlay` body → Task 5. ✓
- chatDrawer type + default title → Task 6. ✓
- Drawer endSession/body/openGeneralChat/"+"/FAB + CSS → Task 7. ✓
- Read-only tools, singleton, hosts untouched → Global Constraints. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `GeneralChatEvent` shape identical across ipc-events/run/router/host; store fields (`message`, `awaitingInput`, `status`, `requestId`, `running`) match host subscription input `{ requestId, message }` and the drawer's `openGeneralChat` guard; `trpc.generalChat.{start,reply,cancel}` used consistently; `startGeneralChat`/`GeneralChatRun` names match between Task 1 and Task 2; `ChatSessionType` includes `generalChat` in Tasks 6/7. ✓

**Note on `done`:** like the benchmark chat, the run never emits `done` (each turn ends with `awaiting-input`); the host handles `done` defensively but the session ends via `cancel`→`aborted`. `openGeneralChat`'s reset therefore keys on active-streaming, not on a terminal status.
