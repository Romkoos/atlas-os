# CHATS Page + Canvas — Design

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation plan
**Area:** renderer — chat surface, navigation

## Summary

Move every chat off the slide-out drawer onto a dedicated full-screen **CHATS**
page reachable from the nav. Remove the drawer and the floating action button
(FAB). The nav item carries a live badge with the count of active chats. The page
splits vertically: the **conversation** on the left, and a **Canvas** on the
right — a tabbed surface whose tabs are specific to the active chat's type. A
draggable divider sets the column widths (default 50/50, each pane has a minimum
width).

Sessions and their subscriptions already live above the page switch (App-level
`ChatHost`s), so relocating the UI never stops a running chat.

## Motivation

The drawer is a cramped, single-column surface that hides each chat type's real
output inside the transcript. There is plenty of horizontal space on screen. A
dedicated page with a second pane gives every chat room to breathe and a home for
its "work product" (a worker's diff, saved ideas, benchmark results, an improver
report) that today gets buried in the conversation.

## Settled decisions

- New nav item **CHATS** with a live active-chat count badge.
- Drawer (`UnifiedChatDrawer` aside) and FAB are **removed**.
- Vertical 2-pane split: left = chat, right = Canvas.
- **Draggable** vertical divider; **default 50/50**; each pane has a **minimum
  width**.
- Right pane = **Canvas**: one component + one tab-strip chrome; each chat type
  contributes its own tabs.
- Per-type Canvas tabs (this iteration):
  - **worker** → `Changes` (live diff + deploy status) · `Docs` (design/plan docs
    the agent writes) · `Artifact` (rendered output, when the work makes one)
  - **idea incubator** (roadmap) → `Ideas` (saved idea cards)
  - **chat** (generalChat) → `Artifact` (render of what the assistant produces) ·
    `Context` (files read & knowledge cited)
  - **discuss results** (benchmark) → `Results` (batch table & analysis)
  - **skill improver** → `Report` (verdicts & proposed edits)
- benchmark and improver stay single-tab for now.
- **Bare chats** (e.g. a general chat that has produced no artifact/context yet):
  the right pane is **empty** — it stays part of the split, showing a minimal
  blank Canvas. The draggable divider lets the user reclaim the width; the pane
  does not auto-collapse.

## Architecture

### 1. Navigation

- `src/renderer/src/store/ui.ts` — add `'chats'` to the `Section` union and
  `SECTIONS` array.
- `src/renderer/src/components/layout/nav.ts` — add a `NAV` entry for `chats`.
  Placement is a product choice; the mock shows it near the top (after ROADMAP).
  Renumber the `[NN]` keys and Cmd+N shortcuts accordingly (keys are 1-based
  index; `App.tsx` already derives the shortcut from `NAV` order).
- `src/renderer/src/App.tsx` — add `chats: ChatsPage` to the `PAGES` map.

### 2. Active-chat badge

Reuse the existing signals-badge pattern in `Sidebar.tsx` (the `.nav-badge`
span). The count is the number of live chat sessions — i.e. the length of the
sessions list in the chats store (see §4). Render the badge on the `chats` nav
item when count > 0, mirroring the `signals` unread branch.

> "Active" = a session that exists in the chats store (open tab), matching the
> current drawer badge semantics (`sessions.length`). We are not narrowing it to
> "currently streaming" — an idle-but-open chat still counts.

### 3. Page layout — `ChatsPage`

New page component `src/renderer/src/pages/Chats.tsx`:

- A **chat tab strip** across the top listing the open chat sessions (same
  content as today's drawer tab strip: title, running dot, ×-to-close, and the
  "+ New chat" picker for Chat vs Worker). Selecting a tab sets the active
  session.
- A **split body** below: left pane (active chat) | draggable divider | right
  pane (Canvas for the active chat's type).

**Split / divider:**
- A reusable `SplitPane` primitive (or inline in `ChatsPage`) renders two panes
  with a draggable gutter.
- Ratio state persisted in the chats store (`splitRatio`, default `0.5`).
- Each pane has a **minimum width** (proposed `360px`; final value a build
  detail). Dragging clamps the ratio so neither pane goes below its minimum.
- Pointer-based drag (pointerdown on gutter → pointermove updates ratio →
  pointerup commits). Keyboard-accessible: gutter is focusable with
  `role="separator"`, `aria-orientation="vertical"`, arrow keys nudge the ratio.
- Respect `prefers-reduced-motion` (no transition on the panes during drag).

### 4. State — `chats` store (replaces `chatDrawer`)

Evolve `src/renderer/src/store/chatDrawer.ts` into a `chats` page store
(`useChats`). It stays **domain-agnostic**: it tracks which chat tabs are open and
UI layout, never the chat sessions themselves (those remain in the per-type run
stores).

Keep the existing, well-tested pieces:
- `sessions: ChatSession[]`, `activeSessionId`, `openSession`, `closeSession`,
  `setActive` — unchanged.
- `mergePersistedChatDrawer` sanitizer (rename to match) and `VALID_TYPES`
  guard — unchanged.

Changes:
- **Drop `open` / `setOpen`** — there is no collapse anymore; the page is always
  "open". Remove from state, persistence, and the merge sanitizer.
- **Add `splitRatio: number`** (default `0.5`, persisted).
- **Add `canvasTabByType: Partial<Record<ChatSessionType, string>>`** — the last
  Canvas tab selected per chat type (persisted) so switching chats restores the
  tab you were on. Default = the type's first tab.
- Bump the persisted `version` and extend `partialize` accordingly.

### 5. Left pane — existing overlays, unchanged bodies

The overlay components (`GeneralChatOverlay`, `WorkerChatOverlay`,
`RoadmapChatOverlay`, `BenchmarkChatOverlay`, `SkillImproverOverlay`) are already
self-contained (intro → `TimelineChatBody` → `ChatComposer`) and read the
App-level run stores. They render **as-is** inside the left pane; only their
container moves from the drawer body to the page's left pane. Close/stop wiring
(the `endSession` logic currently in `UnifiedChatDrawer`) moves to the chat tab
strip's ×.

### 6. Right pane — `Canvas`

New `src/renderer/src/components/chat/Canvas.tsx` (+ a small folder of per-type
views). One component owns the tab-strip chrome and empty state; per-type views
supply the tab set and content.

```
Canvas(activeType)
  → tabsForType(activeType): { key, label, badge?, View }[]
  → active tab from chats store (canvasTabByType) with fallback to tabs[0]
  → renders <View/> for the active tab; empty types render the blank Canvas
```

Per-type tab sources:

| Type | Tab | Data source | Reuse / New |
|---|---|---|---|
| worker | Changes | git diff of the repo working tree + deploy status (`deployed` event already emitted) | **New** (diff plumbing) |
| worker | Docs | design/plan docs the agent writes (e.g. `docs/superpowers/specs`, `plans/`) — detected from tool activity / file watch | **New** |
| worker | Artifact | rendered artifact the run produces (HTML/markdown/code) | **New** |
| idea incubator | Ideas | `useRoadmapSaved` — today holds only the latest `savedItem`; extend to accumulate the session's saved cards into a list | Reuse + small extension |
| chat | Artifact | render of documents/code/tables/HTML the assistant emits in-transcript | **New** |
| chat | Context | files read + knowledge articles cited (derive from tool activity in the run store) | **New** (derive from existing timeline events) |
| discuss results | Results | fetch batch by `useBenchmarkChatContext.batchId` via existing tRPC | Reuse |
| skill improver | Report | `useSkillImproverExtra.report` | Reuse |

**Empty state:** when the active type's tabs have no content (bare general chat),
Canvas renders a minimal blank pane (no tabs, optional very faint hint). It stays
in the split; the user can drag the divider to shrink it.

## Data flow

- Nav → `useUiStore.setSection('chats')` renders `ChatsPage`.
- `ChatsPage` reads `useChats` for tabs / active session / split ratio, and
  renders the active overlay (left) + `Canvas` for the active type (right).
- Overlays and Canvas both read the App-level run stores and companion stores —
  **no new subscription lifecycle**. The App-level `ChatHost`s are unchanged.
- Worker Canvas is the one place needing new main-process data: a diff source, a
  docs/artifact detector. These feed either new companion stores or new tRPC
  queries scoped to the worker session. (Detailed plumbing is deferred to the
  implementation plan; this design only fixes *what* the tabs show.)

## Removed

- `UnifiedChatDrawer.tsx` — deleted. Its tab-strip, picker, and `endSession`
  logic move to `ChatsPage`.
- The FAB and its CSS (`.chat-fab*`), the drawer aside CSS (`.chat-drawer*`), and
  the drawer mount in `App.tsx`.
- `open` / `setOpen` from the chats store.
- Escape-to-collapse handler.

## Edge cases

- **No open chats:** the page shows an empty tab strip with just the "+ New chat"
  picker and an empty body prompting the user to start a chat. Nav badge hidden.
- **Deep-linking to a chat** (e.g. Roadmap "start development" → worker): the
  existing prefill (`useWorkerPrefill`) + `openSession` flow still applies; it
  now also switches the section to `chats`.
- **Persisted split ratio out of range / min-width violations:** clamp on
  rehydrate and on window resize so neither pane is below its minimum.
- **Switching chat type** restores that type's last Canvas tab from
  `canvasTabByType`.

## Testing

- Unit: chats store — `openSession` / `closeSession` / `setActive` (retain
  existing tests), new `splitRatio` clamp, `canvasTabByType` set/restore, and the
  updated `merge`/sanitizer without `open`.
- Unit: `tabsForType` returns the right tab set per type; empty types yield no
  tabs.
- Unit: split-ratio clamp helper (min-width enforcement) as a pure function.
- Component: badge shows session count; hidden at 0.
- Manual (in `pnpm dev`): drag divider (clamps at min widths), switch chats
  (Canvas + tab restore), start/close chats, verify a running worker keeps
  streaming across a section switch away and back.

## Reuse vs new — effort

- **Reuse (cheap):** overlays move verbatim; chat store keeps its core + tests;
  benchmark/improver/idea Canvas views read existing companion stores; badge
  mirrors signals.
- **New (bulk of the work):** `ChatsPage` + `SplitPane` divider; `Canvas`
  component + per-type views; **worker Canvas data plumbing** (diff / docs /
  artifact) is the largest new piece and may warrant being split into its own
  follow-up if the base page + reuse-only Canvases ship first.

## Open questions (minor, resolvable in planning)

- Exact minimum pane width (px).
- Nav placement/number for CHATS (renumbering impact on Cmd+N).
- Whether worker Canvas plumbing (Changes/Docs/Artifact) ships in this pass or as
  a fast follow after the page + reuse-only Canvases land.
