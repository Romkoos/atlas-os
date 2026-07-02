# UnifiedChatDrawer — Design

Date: 2026-07-02

## Goal

Replace the two independent chat surfaces (`BenchmarkChatOverlay` mounted in
`Productivity.tsx`, `RoadmapChatOverlay` modal in `Roadmap.tsx`) with a single
right-side sliding drawer that hosts every chat session behind a tab strip. A
persistent floating button opens the drawer from anywhere. The always-mounted
`BenchmarkChatHost` / `RoadmapChatHost` subscriptions stay untouched, so
sessions keep running in the background regardless of drawer visibility.

## Non-goals

- No changes to tRPC routers, subscription hosts, or the domain chat stores'
  lifecycle (`start` / `reply` / `cancel` / `finish` / `reset`).
- No new session *types* beyond the existing `benchmark` and `roadmap`.
- No persistence of drawer state across app reloads (domain stores are already
  in-memory only).

## Architecture

### 1. `store/chatDrawer.ts` — drawer UI state (domain-agnostic)

```ts
export type ChatSessionType = 'benchmark' | 'roadmap'
export interface ChatSession { id: string; type: ChatSessionType; title: string }

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
```

- **One session per type**: `id === type`. The two domain stores are
  singletons, so at most two tabs exist. `openSession` is idempotent — if a
  session of that type already exists it focuses it, otherwise it appends one.
  It always sets `open = true` and `activeSessionId = id`.
- Default titles: `benchmark → "discuss results"`, `roadmap → "idea incubator"`;
  overridable via the optional `title`.
- `closeSession(id)`: removes the tab. If it was active, switch
  `activeSessionId` to a remaining session, or `null`. If no sessions remain,
  set `open = false`.
- The store does **not** import the domain stores. Ending a session's backend
  run (cancel + reset) is orchestrated by the drawer component, which owns the
  `type → domain store / tRPC cancel mutation` mapping.

### 2. `components/UnifiedChatDrawer.tsx`

- Fixed right-side panel. Slide via a custom CSS class (`.chat-drawer` +
  `.chat-drawer.open`) using `transform: translateX(...)` and a
  `transition: transform`. **Non-modal**, no backdrop — sessions run in the
  background and the rest of the app stays interactive.
- **Header = tab strip**: one chip per open session (title text, active chip
  highlighted, a `×` button per chip). Plus a collapse control that hides the
  panel (`setOpen(false)`) without touching sessions.
- **Body**: renders the active session's component by type —
  `benchmark → <BenchmarkChatOverlay />`, `roadmap → <RoadmapChatOverlay />`.
  Empty state is unreachable in practice (drawer closes when the last tab goes).
- **Tab `×` = end the session**: cancel the running backend request (via the
  matching tRPC cancel mutation when that session is `running`) + call the
  domain store's `reset()`, then `closeSession(id)`. This consolidates the
  close/stop logic that previously lived inside each overlay.
- Renders the **floating action button** (fixed bottom-right) with a badge
  showing the open-session count; click calls `toggle()`.

### 3. Refactor overlays into drawer bodies

- `BenchmarkChatOverlay`: drop `bench-chat-head` (title + CLOSE button). Keep
  the transcript log and input footer. The `status === 'idle'` early-return can
  stay as a defensive guard.
- `RoadmapChatOverlay`: drop the `rm-backdrop` / `rm-backdrop-btn` /
  `rm-modal` / `rm-modal-head` wrappers, the `onClose` prop, the Esc-key
  listener, and the intro's redundant `cancel` button. Keep the intro form
  (idea textarea + "start brainstorming"), the log, and the input footer.
  `startSession` from the intro is unchanged.

### 4. Entry points

- `App.tsx`: mount `<UnifiedChatDrawer />` alongside the existing hosts. Hosts
  unchanged.
- `Productivity.tsx` DISCUSS button (~:2110): call
  `useBenchmarkChatRun.getState().start(batchId)` **and**
  `useChatDrawer.getState().openSession({ type: 'benchmark' })`. Remove the
  `<BenchmarkChatOverlay />` mount (~:2241) and its import.
- `Roadmap.tsx` "new idea" button (~:394): call
  `useChatDrawer.getState().openSession({ type: 'roadmap' })`. Remove the local
  `chatOpen` state, the mid-session re-open `useEffect` (~:343), the
  `<RoadmapChatOverlay onClose=... />` mount (~:472), and the import.

### 5. "Return to a running session" behavior

Tabs persist until explicitly closed and the FAB is always available, so the
user reopens the drawer to see running or finished sessions. The current
auto-open behaviors (Roadmap's re-open `useEffect`, Benchmark's auto-show on
`status !== 'idle'`) are removed — they are no longer needed.

## Styling

All styling in `src/renderer/src/index.css` using custom classes consistent
with the existing project style (no Tailwind utilities for the drawer shell).
New classes: the `.chat-drawer` shell + open state, the tab strip, and the FAB.
Session bodies reuse the existing `.bench-chat-*` / `.rm-chat-*` classes.

## Testing / verification

- Typecheck + build pass.
- Manual/driven verification: DISCUSS opens the drawer on the benchmark tab and
  streams; "new idea" opens the drawer on the roadmap tab; both tabs coexist and
  switch; a running session survives tab navigation and drawer collapse; tab `×`
  cancels + resets and removes the tab; closing the last tab hides the drawer;
  the FAB reopens with sessions intact.
