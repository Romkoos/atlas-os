# ROADMAP Kanban Board — Design

**Date:** 2026-07-03
**Status:** Approved (design), pending implementation plan
**Area:** ROADMAP page (`src/renderer/src/pages/Roadmap.tsx` and supporting modules)

## Summary

Add a Jira/Monday-style card **Board** to the ROADMAP page alongside the existing
category-grouped **List**. The board organizes items into status columns with
drag-and-drop between columns. Two smaller changes ship with it: the status
`idea` is renamed to `todo`, and a persisted toggle hides `done` items across
both views.

This is a UI-forward change. The **only** backend/data change is the
`idea` → `todo` rename plus a guarded one-time migration. A future in-Atlas agent
that executes tasks and writes comments/descriptions is explicitly **out of
scope** here; the detail panel only reserves visual placeholders for it.

## Goals

- Keep the current category List view working, unchanged in behavior.
- Add a status-column Board where every roadmap item appears as a card.
- Drag a card between columns to change its status (optimistic).
- Rename status `idea` → `todo` (data + labels + defaults), migrating existing rows.
- Persisted "Hide done" toggle affecting both List and Board.
- A unified detail panel (replacing today's edit modal) with editable fields and
  placeholder Comments/Activity sections seeding the future agent work.

## Non-Goals

- No agent execution, no real comments, no activity log persistence (placeholders only).
- No manual within-column reordering (in-column order is auto-derived).
- No new statuses beyond the renamed four (no Review/Blocked).
- No per-column quick-add button; no "Assign to agent" stub.
- No changes to how items are created (the header "new idea" brainstorm chat stays).

## Current State (as-built)

- `RoadmapItem` (`src/shared/roadmap.ts`): `title`, `description`, `category`
  (5 kinds), `status` (`idea`/`planned`/`in-progress`/`done`), `priority`,
  `claudePrompt`, `position`, `createdAt`, `updatedAt`.
- `position` orders items **within a category**. It is set at create-time
  (append to category) and is **never user-reorderable** today — there is no
  reorder mutation. The List view groups by category and sorts by position.
- `Roadmap.tsx` renders a KPI row + category-grouped list; each row has a
  segmented status switch, priority pill, copy-prompt / edit / delete actions,
  and opens `RoadmapEditor` (centered modal) for editing.
- Backend: `roadmapRouter` (list/create/update/remove/copyText) over
  `src/main/services/roadmap/store.ts`. The store uses a `roadmap-meta`
  `electron-store` for one-time flags (`seeded`, `claudePromptBackfilled`) —
  the established pattern for guarded one-time operations.
- `ui.ts` zustand store persists `section`, `selectedProject`, and a generic
  `tabsBySection` map (already used by the Knowledge page for sub-tabs).
- No drag-and-drop library is currently installed.

## Design

### 1. Data model & migration

`src/shared/roadmap.ts`:
- `ROADMAP_STATUSES = ['todo', 'planned', 'in-progress', 'done']`.
- `STATUS_LABELS.todo = 'To do'` (drop the `idea` key).
- `roadmapCreateSchema.status` default → `'todo'`.
- Any doc comments referencing "idea" status updated to "todo".

`src/main/services/roadmap/store.ts`:
- Add a `statusIdeaToTodoMigrated` flag to the `RoadmapMeta` interface/defaults.
- New guarded function (called at startup next to `seedRoadmapIfNeeded` /
  `backfillRoadmapClaudePrompts`): if the flag is unset, run
  `UPDATE roadmap_items SET status='todo' WHERE status='idea'`, then set the flag.
- Update `ROADMAP_SEED` usage: seed rows currently hardcode `status: 'idea'` →
  `status: 'todo'`.

Audit: `src/main/services/roadmapChat/seed.ts` (and its prompt) for any
hardcoded `'idea'` status. The brainstorm hand-off parses via
`roadmapCreateSchema`, whose default is now `'todo'`; ensure the seed prompt does
not instruct the agent to emit `status: "idea"` (which would fail enum
validation). Prefer letting the agent omit `status` so the default applies.

Startup wiring lives wherever `seedRoadmapIfNeeded` / `backfillRoadmapClaudePrompts`
are invoked in `src/main/index.ts` — add the migration call alongside them.

### 2. UI state (`src/renderer/src/store/ui.ts`)

- Add `roadmapHideDone: boolean` (default `false`) with a `setRoadmapHideDone`
  action. Include it in `partialize` and in `mergePersistedUi` (coerce to a
  boolean, default `false`).
- The List ⇄ Board view choice reuses the existing `tabsBySection['roadmap']`
  mechanism (values `'list'` | `'board'`, default `'list'`) via `setTab`.
  No new field needed for the view toggle.

Bump the persist `version` only if required by the merge logic; `mergePersistedUi`
already tolerates partial/stale blobs, so a plain additive field needs no bump.

### 3. Page structure (`Roadmap.tsx`)

- Page header gains two controls:
  - **List ⇄ Board** segmented toggle (reads/writes `tabsBySection.roadmap`).
  - **Hide done** switch (reads/writes `roadmapHideDone`).
- Extract the current category-grouped body (KPI row + `byCategory` sections +
  `ItemRow`) into a `RoadmapList` component — behavior unchanged, except it
  filters out `done` items when `roadmapHideDone` is on, and the KPI `idea`
  label becomes `to do`.
- Add a `RoadmapBoard` component, rendered when the active view is `board`.
- The detail panel (see §5) is shared by both views and lives at the page level.

### 4. `RoadmapBoard`

- **Columns:** one per `ROADMAP_STATUSES` entry (To do · Planned · In progress ·
  Done). Column header shows the status label + a live **count badge**.
- **Card grouping:** items grouped by `status`. Within a column, cards are
  **auto-sorted** by priority (High→Low) then `updatedAt` descending. This is a
  pure comparator — no persisted in-column order.
- **Category:** board shows all categories mixed. Each card carries a small
  colored **category badge**. A board-only **category filter** (All + the 5
  categories) narrows visible cards. (The List view is already category-grouped,
  so the filter is board-only.)
- **Cards** display: priority left color-strip (reuse `p-high/p-med/p-low`),
  title, priority short label, category badge, and a copy-prompt affordance on
  hover (only when `claudePrompt` is non-empty). Clicking a card opens the
  detail panel (§5).
- **Drag-and-drop (@dnd-kit):**
  - Add `@dnd-kit/core` dependency.
  - `DndContext` wraps the board; cards are draggables, columns are droppables
    (including empty columns, via an explicit droppable area).
  - `onDragEnd`: if the card's target column differs from its current status,
    fire the existing `roadmap.update` mutation with `{ id, status }`. Reuse the
    List's optimistic-update pattern (`onMutate` sets the cache, `onError` rolls
    back, `onSettled` invalidates) so the card snaps immediately.
  - Same-column drops are no-ops (no manual reordering).
- **Hide done on the board:** when `roadmapHideDone` is on, the Done column
  collapses to a slim **count-only strip that remains a valid drop target**, so a
  card can still be completed while done items are hidden.

### 5. Detail panel (replaces `RoadmapEditor`)

- One centered, wider modal (deliberately not a right-side slide-over, to avoid
  the known Electron title-bar drag-region conflict with the chat drawer).
- Layout: **left** column = editable fields exactly as today (title, description,
  category, status, priority, claude prompt) wired to `roadmap.create` /
  `roadmap.update`. **Right** column = **Comments** and **Activity** sections,
  each rendering a "comes with the agent" empty-state.
- Modes: create-mode (from header "new idea" is unchanged — that still opens the
  brainstorm chat; the detail panel's create path, if reached, hides the
  placeholder sections). Edit/detail-mode shows the placeholders.
- Opened from both the List (row edit) and the Board (card click), replacing the
  standalone `RoadmapEditor`.

### 6. Testing

- `src/shared/roadmap.test.ts`: update enum expectations for `todo`; assert the
  create-schema default is `todo`.
- Migration: unit-test the `idea`→`todo` store migration (rows with `idea`
  become `todo`; flag prevents re-run; user rows with other statuses untouched).
- Extract board logic as **pure functions** and unit-test them:
  - group-by-status
  - hide-done filter
  - category filter
  - in-column sort comparator (priority then recency)
- `e2e/app.spec.ts`: update roadmap expectations affected by the `idea` → `to do`
  label change.

## Data Flow

1. `roadmap.list` query feeds both views (unchanged endpoint).
2. List view: filter (hide-done) → group by category → sort by position (as today).
3. Board view: filter (hide-done + category filter) → group by status → sort by
   comparator → render columns.
4. Drag end → `roadmap.update({ id, status })` (optimistic) → cache patched →
   both views reflect the new status.
5. Detail panel edits → `roadmap.update` / `roadmap.create` → invalidate list.

## Error Handling

- Optimistic drag updates roll back on mutation error (reuse existing pattern),
  with a toast.
- Same-column / no-op drops short-circuit before any mutation.
- Migration is idempotent (guarded flag + `WHERE status='idea'`); safe on every
  startup.
- `mergePersistedUi` coerces a corrupt/absent `roadmapHideDone` to `false`.

## Risks / Notes

- **@dnd-kit** is a new dependency; keep usage minimal (core only, no sortable).
- The `roadmapChat` seed prompt must not hardcode `status: "idea"` — audit during
  implementation to avoid enum-validation failures on agent-proposed ideas.
- `position` semantics are intentionally left untouched (List-only, per-category);
  the board never writes `position`.
