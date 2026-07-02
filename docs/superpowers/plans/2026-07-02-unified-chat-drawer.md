# UnifiedChatDrawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the benchmark and roadmap chat surfaces into a single right-side sliding drawer with a session tab strip, driven by a new domain-agnostic `chatDrawer` Zustand store, without changing the always-mounted subscription hosts.

**Architecture:** A new `chatDrawer` store tracks `{ open, sessions[], activeSessionId }` (one session per type, `id === type`). `UnifiedChatDrawer` renders a fixed panel + a floating action button, hosts the active session's refactored body component, and orchestrates cancel+reset on tab close. The existing `BenchmarkChatHost` / `RoadmapChatHost` and domain stores are untouched, so sessions keep running in the background.

**Tech Stack:** React 18, Zustand, tRPC (`@renderer/lib/trpc`), lucide-react 1.16.0, vitest, plain CSS in `src/renderer/src/index.css`.

## Global Constraints

- All UI strings in English; only generated digest content may be non-English.
- Styling uses custom CSS classes in `src/renderer/src/index.css` (project style), NOT Tailwind utilities, for the drawer shell/tabs/FAB. Session bodies reuse existing `.bench-chat-*` / `.rm-chat-*` classes.
- Do NOT modify `BenchmarkChatHost.tsx`, `RoadmapChatHost.tsx`, or the domain stores' lifecycle actions.
- Do NOT auto-commit unless the executor is explicitly authorized; the "Commit" steps below are opt-in — skip them if the running policy forbids commits and leave changes in the working tree.
- Import alias is `@renderer/...`. Icons come from `lucide-react`.
- Typecheck: `pnpm typecheck`. Tests: `pnpm test`. Build: `pnpm build`.

---

### Task 1: `chatDrawer` store

**Files:**
- Create: `src/renderer/src/store/chatDrawer.ts`
- Test: `src/renderer/src/store/chatDrawer.test.ts`

**Interfaces:**
- Consumes: `zustand` `create`.
- Produces:
  - `type ChatSessionType = 'benchmark' | 'roadmap'`
  - `interface ChatSession { id: string; type: ChatSessionType; title: string }`
  - `useChatDrawer` store with state `{ open: boolean; sessions: ChatSession[]; activeSessionId: string | null }` and actions `openSession({ type, title? })`, `closeSession(id)`, `setActive(id)`, `setOpen(open)`, `toggle()`.
  - Invariant: `id === type` (one session per type). `openSession` is idempotent per type.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/store/chatDrawer.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatDrawer } from './chatDrawer'

beforeEach(() => {
  useChatDrawer.setState({ open: false, sessions: [], activeSessionId: null })
})

describe('useChatDrawer.openSession', () => {
  it('adds a session, opens the drawer, and makes it active', () => {
    useChatDrawer.getState().openSession({ type: 'benchmark' })
    const s = useChatDrawer.getState()
    expect(s.open).toBe(true)
    expect(s.sessions).toEqual([{ id: 'benchmark', type: 'benchmark', title: 'discuss results' }])
    expect(s.activeSessionId).toBe('benchmark')
  })

  it('is idempotent per type: re-opening focuses the existing session (no duplicate)', () => {
    const { openSession, setActive } = useChatDrawer.getState()
    openSession({ type: 'benchmark' })
    openSession({ type: 'roadmap' })
    setActive('benchmark')
    useChatDrawer.getState().openSession({ type: 'roadmap' })
    const s = useChatDrawer.getState()
    expect(s.sessions).toHaveLength(2)
    expect(s.activeSessionId).toBe('roadmap')
    expect(s.open).toBe(true)
  })

  it('uses the default title per type and honors a custom title', () => {
    useChatDrawer.getState().openSession({ type: 'roadmap' })
    expect(useChatDrawer.getState().sessions[0].title).toBe('idea incubator')
    useChatDrawer.setState({ open: false, sessions: [], activeSessionId: null })
    useChatDrawer.getState().openSession({ type: 'benchmark', title: 'custom' })
    expect(useChatDrawer.getState().sessions[0].title).toBe('custom')
  })
})

describe('useChatDrawer.closeSession', () => {
  it('removes a session and closes the drawer when none remain', () => {
    const { openSession, closeSession } = useChatDrawer.getState()
    openSession({ type: 'benchmark' })
    closeSession('benchmark')
    const s = useChatDrawer.getState()
    expect(s.sessions).toEqual([])
    expect(s.activeSessionId).toBeNull()
    expect(s.open).toBe(false)
  })

  it('switches active to a remaining session and keeps the drawer open', () => {
    const { openSession, setActive, closeSession } = useChatDrawer.getState()
    openSession({ type: 'benchmark' })
    openSession({ type: 'roadmap' })
    setActive('roadmap')
    closeSession('roadmap')
    const s = useChatDrawer.getState()
    expect(s.sessions.map((x) => x.id)).toEqual(['benchmark'])
    expect(s.activeSessionId).toBe('benchmark')
    expect(s.open).toBe(true)
  })
})

describe('useChatDrawer misc actions', () => {
  it('toggle flips open and setOpen sets it explicitly', () => {
    useChatDrawer.getState().toggle()
    expect(useChatDrawer.getState().open).toBe(true)
    useChatDrawer.getState().setOpen(false)
    expect(useChatDrawer.getState().open).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/renderer/src/store/chatDrawer.test.ts`
Expected: FAIL — cannot resolve `./chatDrawer`.

- [ ] **Step 3: Write the store**

Create `src/renderer/src/store/chatDrawer.ts`:

```ts
import { create } from 'zustand'

export type ChatSessionType = 'benchmark' | 'roadmap'

export interface ChatSession {
  id: string
  type: ChatSessionType
  title: string
}

const DEFAULT_TITLES: Record<ChatSessionType, string> = {
  benchmark: 'discuss results',
  roadmap: 'idea incubator',
}

// UI-only state for the unified chat drawer. Deliberately domain-agnostic: it
// tracks which chat tabs are visible, not the chat sessions themselves (those
// live in benchmarkChatRun / roadmapChatRun). One session per type → id === type.
interface ChatDrawerState {
  open: boolean
  sessions: ChatSession[]
  activeSessionId: string | null

  openSession: (s: { type: ChatSessionType; title?: string }) => void
  closeSession: (id: string) => void
  setActive: (id: string) => void
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useChatDrawer = create<ChatDrawerState>((set) => ({
  open: false,
  sessions: [],
  activeSessionId: null,

  openSession: ({ type, title }) =>
    set((s) => {
      const existing = s.sessions.find((x) => x.type === type)
      if (existing) return { open: true, activeSessionId: existing.id }
      const session: ChatSession = { id: type, type, title: title ?? DEFAULT_TITLES[type] }
      return { open: true, sessions: [...s.sessions, session], activeSessionId: session.id }
    }),

  closeSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((x) => x.id !== id)
      const activeSessionId =
        s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId
      return { sessions, activeSessionId, open: sessions.length > 0 ? s.open : false }
    }),

  setActive: (id) => set({ activeSessionId: id }),
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/renderer/src/store/chatDrawer.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/chatDrawer.ts src/renderer/src/store/chatDrawer.test.ts
git commit -m "feat(chat): add chatDrawer store for unified chat drawer"
```

---

### Task 2: Refactor `BenchmarkChatOverlay` into a drawer body

**Files:**
- Modify: `src/renderer/src/components/BenchmarkChatOverlay.tsx`

**Interfaces:**
- Consumes: `useBenchmarkChatRun`, `trpc.benchmarkChat.reply`.
- Produces: `BenchmarkChatOverlay()` — no props; renders `.bench-chat-body` (log + input footer) with no header and no close/cancel control (the drawer owns those).

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `src/renderer/src/components/BenchmarkChatOverlay.tsx` with:

```tsx
// src/renderer/src/components/BenchmarkChatOverlay.tsx
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { useEffect, useRef, useState } from 'react'

// Body of the benchmark-discussion session, rendered inside UnifiedChatDrawer.
// Reads the App-level store, so the session continues even when this body is
// unmounted (tab switch / drawer collapse). Close/stop is owned by the drawer.
export function BenchmarkChatOverlay() {
  const status = useBenchmarkChatRun((s) => s.status)
  const requestId = useBenchmarkChatRun((s) => s.requestId)
  const transcript = useBenchmarkChatRun((s) => s.transcript)
  const streaming = useBenchmarkChatRun((s) => s.streaming)
  const awaitingInput = useBenchmarkChatRun((s) => s.awaitingInput)
  const pushUserReply = useBenchmarkChatRun((s) => s.pushUserReply)

  const reply = trpc.benchmarkChat.reply.useMutation()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  if (status === 'idle') return null

  const send = () => {
    const text = draft.trim()
    if (!text || !requestId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ requestId, text })
    setDraft('')
  }

  return (
    <div className="bench-chat-body">
      <div className="bench-chat-log" ref={logRef}>
        {transcript.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only; no stable id
          <div key={i} className={`bench-chat-entry ${e.kind}`}>
            {e.kind === 'tool' ? `· ${e.text}` : e.text}
          </div>
        ))}
        {streaming ? <div className="bench-chat-entry assistant">{streaming}</div> : null}
      </div>
      <div className="bench-chat-foot">
        <textarea
          className="input"
          rows={2}
          value={draft}
          placeholder={awaitingInput ? 'Ask about the results…' : 'Model is working…'}
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
          SEND
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (note: `Productivity.tsx` still imports/mounts the old overlay and compiles — this task only changes the component's internals; the mount is removed in Task 5).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/BenchmarkChatOverlay.tsx
git commit -m "refactor(chat): make BenchmarkChatOverlay a headless drawer body"
```

---

### Task 3: Refactor `RoadmapChatOverlay` into a drawer body

**Files:**
- Modify: `src/renderer/src/components/RoadmapChatOverlay.tsx`

**Interfaces:**
- Consumes: `useRoadmapChatRun`, `trpc.roadmapChat.reply`.
- Produces: `RoadmapChatOverlay()` — **no props** (drops `onClose`); renders `.rm-chat-body` containing the intro form (idea textarea + "start brainstorming") when not started, else log + input footer. No backdrop, no modal head, no Esc handling, no cancel/close control.

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `src/renderer/src/components/RoadmapChatOverlay.tsx` with:

```tsx
import { trpc } from '@renderer/lib/trpc'
import { useRoadmapChatRun } from '@renderer/store/roadmapChatRun'
import { CheckCircle2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Body of the roadmap brainstorming session, rendered inside UnifiedChatDrawer.
// Reads the App-level store, so the session survives tab switches / drawer
// collapse (the subscription lives in RoadmapChatHost). Close/stop is owned by
// the drawer.
export function RoadmapChatOverlay() {
  const status = useRoadmapChatRun((s) => s.status)
  const requestId = useRoadmapChatRun((s) => s.requestId)
  const transcript = useRoadmapChatRun((s) => s.transcript)
  const streaming = useRoadmapChatRun((s) => s.streaming)
  const awaitingInput = useRoadmapChatRun((s) => s.awaitingInput)
  const savedItem = useRoadmapChatRun((s) => s.savedItem)
  const startSession = useRoadmapChatRun((s) => s.start)
  const pushUserReply = useRoadmapChatRun((s) => s.pushUserReply)

  const reply = trpc.roadmapChat.reply.useMutation()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const started = status !== 'idle'

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming, savedItem])

  const beginBrainstorm = () => {
    const idea = draft.trim()
    if (!idea) return
    startSession(idea)
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
          <span className="rm-field-label">Describe your idea</span>
          <textarea
            className="input"
            rows={5}
            value={draft}
            placeholder="e.g. a panel that shows which skills I use most and suggests ones to retire…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                beginBrainstorm()
              }
            }}
            // biome-ignore lint/a11y/noAutofocus: focus the idea field when the incubator opens
            autoFocus
          />
          <div className="rm-chat-hint">
            The agent will brainstorm it with you (in your language) and save a finished, English
            card to the right category. ⌘↵ to start.
          </div>
          <div className="rm-chat-intro-foot">
            <button
              type="button"
              className="btn primary"
              onClick={beginBrainstorm}
              disabled={!draft.trim()}
            >
              start brainstorming
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
            {savedItem ? (
              <div className="rm-chat-saved">
                <CheckCircle2 size={14} />
                saved to {savedItem.category}: {savedItem.title}
              </div>
            ) : null}
          </div>
          <div className="rm-chat-foot">
            <textarea
              className="input"
              rows={2}
              value={draft}
              placeholder={awaitingInput ? 'Reply…' : 'Agent is thinking…'}
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
Expected: FAIL in `src/renderer/src/pages/Roadmap.tsx` — the old `<RoadmapChatOverlay onClose=... />` mount now passes a prop the component no longer accepts. This is expected and is fixed in Task 6. (The component file itself is correct.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/RoadmapChatOverlay.tsx
git commit -m "refactor(chat): make RoadmapChatOverlay a headless drawer body"
```

---

### Task 4: `UnifiedChatDrawer` component

**Files:**
- Create: `src/renderer/src/components/UnifiedChatDrawer.tsx`

**Interfaces:**
- Consumes:
  - `useChatDrawer` (Task 1): `open`, `sessions`, `activeSessionId`, `setActive`, `setOpen`, `toggle`, `closeSession`, type `ChatSessionType`.
  - `useBenchmarkChatRun` / `useRoadmapChatRun` state fields `requestId`, `running`, action `reset()`.
  - `trpc.benchmarkChat.cancel`, `trpc.roadmapChat.cancel` (input `{ requestId }`).
  - `BenchmarkChatOverlay` (Task 2, no props), `RoadmapChatOverlay` (Task 3, no props).
- Produces: `UnifiedChatDrawer()` — no props; renders the FAB + the sliding panel. Ends a session (cancel running request + `reset()` + `closeSession(id)`) when a tab's `×` is clicked.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/UnifiedChatDrawer.tsx`:

```tsx
import { BenchmarkChatOverlay } from '@renderer/components/BenchmarkChatOverlay'
import { RoadmapChatOverlay } from '@renderer/components/RoadmapChatOverlay'
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { type ChatSessionType, useChatDrawer } from '@renderer/store/chatDrawer'
import { useRoadmapChatRun } from '@renderer/store/roadmapChatRun'
import { MessageSquare, X } from 'lucide-react'

// The single UI surface for every chat session. Sessions themselves live in the
// domain stores and their subscriptions in the App-level hosts, so collapsing
// the drawer (or switching tabs) never stops a run. Only a tab's × ends a run.
export function UnifiedChatDrawer() {
  const open = useChatDrawer((s) => s.open)
  const sessions = useChatDrawer((s) => s.sessions)
  const activeSessionId = useChatDrawer((s) => s.activeSessionId)
  const setActive = useChatDrawer((s) => s.setActive)
  const setOpen = useChatDrawer((s) => s.setOpen)
  const toggle = useChatDrawer((s) => s.toggle)
  const closeSession = useChatDrawer((s) => s.closeSession)

  const benchCancel = trpc.benchmarkChat.cancel.useMutation()
  const roadmapCancel = trpc.roadmapChat.cancel.useMutation()

  const endSession = (type: ChatSessionType) => {
    if (type === 'benchmark') {
      const st = useBenchmarkChatRun.getState()
      if (st.requestId && st.running) benchCancel.mutate({ requestId: st.requestId })
      st.reset()
    } else {
      const st = useRoadmapChatRun.getState()
      if (st.requestId && st.running) roadmapCancel.mutate({ requestId: st.requestId })
      st.reset()
    }
    closeSession(type) // id === type
  }

  const active = sessions.find((s) => s.id === activeSessionId)

  return (
    <>
      <button type="button" className="chat-fab" aria-label="Open chat" onClick={toggle}>
        <MessageSquare size={18} />
        {sessions.length > 0 ? <span className="chat-fab-badge">{sessions.length}</span> : null}
      </button>

      <aside className={`chat-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="chat-drawer-tabs">
          <div className="chat-drawer-tablist">
            {sessions.map((s) => (
              <div key={s.id} className={`chat-tab${s.id === activeSessionId ? ' active' : ''}`}>
                <button type="button" className="chat-tab-btn" onClick={() => setActive(s.id)}>
                  {s.title}
                </button>
                <button
                  type="button"
                  className="chat-tab-x"
                  aria-label={`Close ${s.title}`}
                  onClick={() => endSession(s.type)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="chat-drawer-collapse"
            aria-label="Collapse chat"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
        </div>
        <div className="chat-drawer-body">
          {active?.type === 'benchmark' ? <BenchmarkChatOverlay /> : null}
          {active?.type === 'roadmap' ? <RoadmapChatOverlay /> : null}
        </div>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: still FAILs only in `Roadmap.tsx` (Task 3's known break, fixed in Task 6). `UnifiedChatDrawer.tsx` itself must contribute no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/UnifiedChatDrawer.tsx
git commit -m "feat(chat): add UnifiedChatDrawer with tab strip and FAB"
```

---

### Task 5: Wire Productivity DISCUSS + mount drawer in App; remove old benchmark mount

**Files:**
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/pages/Productivity.tsx`

**Interfaces:**
- Consumes: `UnifiedChatDrawer` (Task 4), `useChatDrawer.openSession` (Task 1), `useBenchmarkChatRun.getState().start` (existing).
- Produces: DISCUSS now starts the benchmark run AND opens the drawer on the benchmark tab; the standalone `<BenchmarkChatOverlay />` mount is gone.

- [ ] **Step 1: Mount the drawer in App.tsx**

In `src/renderer/src/App.tsx`, add the import next to the other component imports (keep alphabetical grouping near `SkillImproverHost`):

```tsx
import { UnifiedChatDrawer } from '@renderer/components/UnifiedChatDrawer'
```

Then add the drawer alongside the hosts. Change:

```tsx
      <BenchmarkChatHost />
      <RoadmapChatHost />
      <Toaster theme={theme} richColors closeButton />
```

to:

```tsx
      <BenchmarkChatHost />
      <RoadmapChatHost />
      <UnifiedChatDrawer />
      <Toaster theme={theme} richColors closeButton />
```

- [ ] **Step 2: Update the DISCUSS button and remove the old overlay in Productivity.tsx**

In `src/renderer/src/pages/Productivity.tsx`:

Remove the overlay import (line 1):

```tsx
import { BenchmarkChatOverlay } from '@renderer/components/BenchmarkChatOverlay'
```

Add the drawer-store import near the other `@renderer/store` imports (after the `useBenchmarkChatRun` import on line 13):

```tsx
import { useChatDrawer } from '@renderer/store/chatDrawer'
```

Change the DISCUSS `onClick` (line ~2110) from:

```tsx
                  onClick={() => useBenchmarkChatRun.getState().start(analysis.data?.batchId ?? '')}
```

to:

```tsx
                  onClick={() => {
                    useBenchmarkChatRun.getState().start(analysis.data?.batchId ?? '')
                    useChatDrawer.getState().openSession({ type: 'benchmark' })
                  }}
```

Remove the standalone overlay mount (line ~2241):

```tsx
      <BenchmarkChatOverlay />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: still FAILs only in `Roadmap.tsx` (Task 6). No new errors in `App.tsx` or `Productivity.tsx`; the removed `BenchmarkChatOverlay` import must have no remaining references in `Productivity.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/pages/Productivity.tsx
git commit -m "feat(chat): open benchmark chat in drawer; mount UnifiedChatDrawer"
```

---

### Task 6: Wire Roadmap "new idea" to the drawer; remove local overlay state

**Files:**
- Modify: `src/renderer/src/pages/Roadmap.tsx`

**Interfaces:**
- Consumes: `useChatDrawer.openSession` (Task 1).
- Produces: "new idea" opens the drawer on the roadmap tab; the local `chatOpen` state, the mid-session re-open `useEffect`, the `<RoadmapChatOverlay onClose=... />` mount, and now-unused imports are gone.

- [ ] **Step 1: Swap the imports**

In `src/renderer/src/pages/Roadmap.tsx`:

Remove the overlay import (line 2):

```tsx
import { RoadmapChatOverlay } from '@renderer/components/RoadmapChatOverlay'
```

Remove the now-unused chat-run store import (line 5) — it is only used by `chatStatus`, which is being deleted:

```tsx
import { useRoadmapChatRun } from '@renderer/store/roadmapChatRun'
```

Add the drawer-store import in the same `@renderer/store` import group:

```tsx
import { useChatDrawer } from '@renderer/store/chatDrawer'
```

(Leave `import { useEffect, useState } from 'react'` unchanged — both are still used elsewhere in the file, e.g. the effects at lines ~73 and ~89.)

- [ ] **Step 2: Delete the local chat state + re-open effect**

Remove these three lines (the `chatOpen` state and `chatStatus` selector, ~338-339):

```tsx
  const [chatOpen, setChatOpen] = useState(false)
  const chatStatus = useRoadmapChatRun((s) => s.status)
```

And the mid-session re-open effect (~341-345):

```tsx
  // Re-open the incubator when returning to the page mid-session (the session
  // itself lives at App level and keeps running while the tab is away).
  useEffect(() => {
    if (chatStatus !== 'idle') setChatOpen(true)
  }, [chatStatus])
```

- [ ] **Step 3: Point "new idea" at the drawer**

Change the "new idea" button `onClick` (~394):

```tsx
          <button type="button" className="btn primary" onClick={() => setChatOpen(true)}>
```

to:

```tsx
          <button
            type="button"
            className="btn primary"
            onClick={() => useChatDrawer.getState().openSession({ type: 'roadmap' })}
          >
```

- [ ] **Step 4: Remove the overlay mount**

Remove the conditional mount (~472):

```tsx
      {chatOpen ? <RoadmapChatOverlay onClose={() => setChatOpen(false)} /> : null}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS with no errors (the Task 3 break is now resolved, and no unused-import/unused-var errors remain).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Roadmap.tsx
git commit -m "feat(chat): open roadmap incubator in drawer; drop local overlay state"
```

---

### Task 7: Drawer, tab strip, and FAB styles

**Files:**
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: existing CSS custom properties (`--panel`, `--bg-2`, `--line`, `--fg`, `--fg-2`, `--fg-3`, `--amber`) and the existing `.bench-chat-log/-entry/-foot`, `.rm-chat-log/-entry/-foot/-intro/-hint/-saved`, `.rm-field-label` classes.
- Produces: `.chat-drawer` (+ `.open`), `.chat-drawer-tabs`, `.chat-drawer-tablist`, `.chat-tab` (+ `.active`), `.chat-tab-btn`, `.chat-tab-x`, `.chat-drawer-collapse`, `.chat-drawer-body`, `.rm-chat-intro-foot`, `.chat-fab`, `.chat-fab-badge`.

- [ ] **Step 1: Add the drawer/FAB CSS inside `@layer components`**

In `src/renderer/src/index.css`, immediately AFTER the `.bench-chat-foot { ... }` rule (ends at line ~1317, still inside the `@layer components {` block opened at line 160), insert:

```css
  /* ============ UNIFIED CHAT DRAWER ============ */
  .chat-fab {
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--panel);
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    cursor: pointer;
    z-index: 60;
  }
  .chat-fab:hover {
    color: var(--fg);
    border-color: var(--amber);
  }
  .chat-fab-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--mono);
    font-size: 10px;
    color: var(--bg);
    background: var(--amber);
    border-radius: 8px;
  }
  .chat-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 440px;
    max-width: 90vw;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border-left: 1px solid var(--line);
    box-shadow: -8px 0 32px rgba(0, 0, 0, 0.4);
    transform: translateX(100%);
    transition: transform 0.24s ease;
    z-index: 55;
  }
  .chat-drawer.open {
    transform: translateX(0);
  }
  .chat-drawer-tabs {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border-bottom: 1px solid var(--line);
  }
  .chat-drawer-tablist {
    display: flex;
    flex: 1;
    gap: 6px;
    overflow-x: auto;
  }
  .chat-tab {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 10px;
    background: var(--bg-2);
    border: 1px solid var(--line);
    border-radius: 6px;
    white-space: nowrap;
  }
  .chat-tab.active {
    border-color: var(--amber);
  }
  .chat-tab-btn {
    background: none;
    border: 0;
    padding: 0;
    color: var(--fg-3);
    font-family: var(--mono);
    font-size: 12px;
    cursor: pointer;
  }
  .chat-tab.active .chat-tab-btn {
    color: var(--fg);
  }
  .chat-tab-x {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 0;
    padding: 2px;
    color: var(--fg-4);
    cursor: pointer;
  }
  .chat-tab-x:hover {
    color: var(--fg);
  }
  .chat-drawer-collapse {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 0;
    padding: 4px;
    color: var(--fg-3);
    cursor: pointer;
  }
  .chat-drawer-collapse:hover {
    color: var(--fg);
  }
  .chat-drawer-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .bench-chat-body,
  .rm-chat-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .rm-chat-intro-foot {
    display: flex;
    justify-content: flex-end;
    margin-top: 12px;
  }
```

Note: the existing `.bench-chat-log`, `.bench-chat-foot`, `.rm-chat-log`, `.rm-chat-foot`, `.rm-chat-intro`, `.rm-chat-hint`, `.rm-chat-saved` rules are reused as-is by the refactored bodies; do not duplicate or remove them.

- [ ] **Step 2: Verify build + lint**

Run: `pnpm build`
Expected: PASS (typecheck + electron-vite build succeed).

Run: `pnpm lint`
Expected: PASS (no Biome errors in the changed files).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "style(chat): add unified chat drawer, tab strip, and FAB styles"
```

---

### Task 8: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS, including `chatDrawer.test.ts`.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Drive the app (use the `/run` skill or `pnpm dev`) and confirm:**

- Clicking DISCUSS on the Productivity analysis panel opens the drawer with a "discuss results" tab active and streams the model output.
- Clicking "new idea" on Roadmap opens the drawer with an "idea incubator" tab; typing an idea + "start brainstorming" begins the session.
- With both sessions open, two tabs appear and clicking a tab switches the body.
- Navigating to another section and collapsing the drawer (top-right ×) does NOT stop a running session; reopening via the FAB shows it still live/streaming.
- The FAB badge shows the open-session count.
- Clicking a tab's × cancels a running request, resets that session, and removes the tab; closing the last tab hides the drawer.

- [ ] **Step 4: Commit any fixes surfaced by verification**

```bash
git add -A
git commit -m "fix(chat): address issues found during verification"
```

(Skip if verification surfaced nothing.)

---

## Self-Review

**Spec coverage:**
- `chatDrawer` store with `{sessions[], activeSessionId}` + actions → Task 1. ✓
- `UnifiedChatDrawer` fixed sliding panel + tab strip → Tasks 4, 7. ✓
- Refactor both overlays to render inside the drawer, remove page-level mounting → Tasks 2, 3, 5, 6. ✓
- Persistent open-drawer button (FAB, per user choice) in global layout → Tasks 4 (render), 5 (mount in App), 7 (style). ✓
- Entry points call `openSession({ type })` → Tasks 5 (Productivity), 6 (Roadmap). ✓
- Hosts unchanged → enforced by Global Constraints; no task touches them. ✓
- Tab × = cancel + reset (user decision) → Task 4 `endSession`. ✓
- Custom CSS, project style (user decision) → Task 7. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `openSession({ type, title? })`, `closeSession(id)`, `setActive`, `setOpen`, `toggle` used identically across Tasks 1/4/5/6. `id === type` invariant lets Task 4 call `closeSession(type)`. Cancel mutation input `{ requestId }` matches existing overlay usage. `RoadmapChatOverlay` prop drop (Task 3) is the intended break fixed in Task 6. ✓
