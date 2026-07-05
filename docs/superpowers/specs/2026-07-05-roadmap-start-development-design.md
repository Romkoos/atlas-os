# Roadmap "Start development" button — design

Date: 2026-07-05
Branch: `feat/roadmap-start-development`

## Goal

On the Roadmap page, replace the per-idea **Copy Claude Code prompt** button
(present on both the **List** and **Board** tabs) with a **Start development**
button. Clicking it opens the **worker** chat in the unified drawer, preloads
the idea's `claudePrompt` into the worker's intro composer, and preselects the
latest **Opus** model. The prompt is **not** auto-sent — the user reviews it and
presses "start worker" themselves.

## Current behavior (baseline)

- `RoadmapList.tsx` and `RoadmapBoard.tsx` each render a `<Copy>` icon button,
  shown only when `item.claudePrompt` is non-empty. Both bubble up to
  `Roadmap.tsx` via `onCopy(text) → roadmap.copyText.mutate({ text })`
  (clipboard write + success toast).
- `WorkerChatOverlay.tsx` has an *intro* state (`status === 'idle'`): a `draft`
  textarea, a `ChatModelSelect`, and a "start worker" button that calls
  `startSession(draft, model)`. `draft` and `model` are **local** component
  state.
- The worker chat is a single session per type (`id === 'worker'`), opened via
  `useChatDrawer.getState().openSession({ type: 'worker' })`.
- Latest Opus model id: `claude-opus-4-8` (from `@shared/models`).

## Design

### 1. Prefill channel — new store

The worker intro's `draft`/`model` are local state, so an external caller can't
seed them directly. Add a tiny dedicated zustand store:

`src/renderer/src/store/workerPrefill.ts`

```ts
interface WorkerPrefill {
  prompt: string
  model: ClaudeModelId | null
}
interface WorkerPrefillState {
  pending: WorkerPrefill | null
  setPrefill: (p: WorkerPrefill) => void
  clearPrefill: () => void
}
```

Not persisted — it's a transient hand-off consumed once on the next worker-intro
render.

### 2. Button swap (List + Board)

Replace the `Copy` icon with a "start development" action in both
`RoadmapList.tsx` and `RoadmapBoard.tsx`, keeping the same gate
(`item.claudePrompt` non-empty) and the same stop-propagation behavior on the
Board card (so it doesn't trigger drag/open).

- Icon: `Rocket` (lucide-react).
- `aria-label` / `title`: "Start development".
- The prop threaded through both components is renamed `onCopy → onStartDev`
  (signature `(item: RoadmapItem) => void`, since the handler needs the whole
  item, not just the prompt text).

### 3. Orchestrator wiring — `Roadmap.tsx`

Replace the `copyText` mutation wiring with an `onStartDev(item)` handler:

```
onStartDev(item):
  const run = useWorkerChatRun.getState()
  const busy = ['running','awaiting','reconnecting','limited'].includes(run.status)
  if (busy) {
    useChatDrawer.getState().openSession({ type: 'worker' })
    toast.error('Worker is busy — finish or close it first')
    return
  }
  run.reset()                        // safe: idle/done/error/aborted only
  useWorkerPrefill.getState().setPrefill({
    prompt: item.claudePrompt,
    model: 'claude-opus-4-8',
  })
  useChatDrawer.getState().openSession({ type: 'worker' })
```

Rationale for the collision rule: there is only one worker session. When it is
actively working we must not clobber it, so we just surface it with a toast.
When it is idle or finished (`done`/`error`/`aborted`) a `reset()` is safe and
lets the fresh idea populate the intro.

### 4. Consume prefill — `WorkerChatOverlay.tsx`

In the intro branch, read `useWorkerPrefill`. When a `pending` prefill exists,
seed the local `draft` and `model` once, then `clearPrefill()`. Use a
`useEffect` keyed on the pending object so it runs exactly once per hand-off:

```
useEffect(() => {
  if (!pending) return
  setDraft(pending.prompt)
  if (pending.model !== undefined) setModel(pending.model)
  clearPrefill()
}, [pending])
```

The user still sees the standard intro — prompt loaded, Opus preselected in
`ChatModelSelect`, both fully editable — and presses "start worker" to send.
No auto-start.

### 5. Leftovers

`roadmap.copyText` tRPC route is left in place (harmless, no longer wired to a
button). No schema/data changes; `claudePrompt` already exists on `RoadmapItem`.

## Testing

- Unit: `workerPrefill` store — `setPrefill` sets `pending`, `clearPrefill`
  nulls it.
- Existing `board-utils` / roadmap store tests must stay green.
- Manual (Electron): List + Board "Start development" → drawer opens on worker,
  intro shows the idea's prompt with Opus selected, nothing sent until the user
  clicks "start worker". Busy-worker case shows the toast and does not clobber.

## Out of scope

- Auto-sending the prompt.
- Changing the `RoadmapDetail` editor (it edits `claudePrompt`; no copy button
  there).
- Multi-worker / queued sessions.
