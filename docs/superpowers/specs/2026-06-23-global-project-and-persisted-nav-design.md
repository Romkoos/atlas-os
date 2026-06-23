# Global project selection + persisted last page/tab

**Date:** 2026-06-23
**Status:** Approved (design), pending implementation plan

## Problem

Two things should survive page-switches, refreshes, and new sessions:

1. **Project selection is per-page, not global.** Knowledge and Productivity each
   own a local project dropdown. Picking a project on one page has no effect on the
   other, and the choice is lost on reload.
2. **No navigation memory.** The active page (section) and the active tab within a
   page reset to defaults on every refresh / new session.

Additionally, the Productivity `days` range selector is shown on a tab where it does
nothing (Benchmark), which is misleading.

## Goals

- A single **global project selection** shared across every page that has a project
  selector (today: Knowledge, Productivity).
- Persist and restore the **last-visited section** and the **last-active tab per page**
  across refresh and across sessions.
- **Remove the `days` range selector where it is irrelevant** (Productivity Benchmark
  tab).

## Non-goals (YAGNI)

- Persisting the `days` range value, search queries, scroll position, drawer state, or
  graph view state.
- A global "all projects" concept for Knowledge (it has no such view today).
- Any backend / tRPC / router changes. This is a pure renderer change.

## Key fact that makes this simple

In this environment the knowledge-base folder name equals the project path basename,
which equals Productivity's `project` display name:

- `knowledge.projects[].name` = folder under `~/atlas-knowledge` (e.g. `atlas-os`,
  `mako3.0`, `player-mako`).
- `productivity.projects[].project` = `basename(projectPath)` (same strings).

Verified against `~/atlas-knowledge/_engine/projects.json` whose keys are path
basenames. Therefore the global selection can be keyed by **project name** and matched
across pages by string equality. No path plumbing or backend field additions required.

Known edge case (accepted): two tracked projects with the same basename would collide.
This is a best-effort map by design.

## Design

### 1. Canonical model

A single global selection lives in the `ui` store, keyed by **project name**:

```ts
selectedProject: string | null
```

`null` carries a deliberate dual meaning that implements the "best-effort map":

- **Knowledge** treats `null` (or a name not in its list) as "fall back to the first
  project" — its current behavior.
- **Productivity** treats `null` (or a name not in its list) as **"all projects."**

Selecting a real project on either page sets the global name; the other page reflects it
if it has a matching project. Selecting "all projects" in Productivity sets the global
back to `null`.

### 2. Store — `src/renderer/src/store/ui.ts`

Wrap the existing zustand store in the `persist` middleware (localStorage; available in
the Electron renderer, consistent with the existing zustand pattern).

State shape:

```ts
type Section = /* unchanged union */

interface UiState {
  section: Section                                 // now persisted
  selectedProject: string | null                   // global, name-keyed
  tabsBySection: Partial<Record<Section, string>>  // last tab per page
  setSection: (section: Section) => void
  setSelectedProject: (project: string | null) => void
  setTab: (section: Section, tab: string) => void
}
```

Persistence details:

- `persist` with a stable `name` key (e.g. `atlas-ui`) and an explicit `version`.
- A `merge` (or `onRehydrateStorage`) guard validates rehydrated values:
  - unknown `section` → fall back to `dashboard`;
  - a stored tab that is not valid for its page → dropped, so the page uses its own
    default.
- Only `section`, `selectedProject`, and `tabsBySection` are persisted (use `partialize`
  if any transient fields are added later).

Tab-value validation lives with each page (the page knows its own valid tab ids); the
store stays generic by holding `string` tab ids.

### 3. Page wiring

**Knowledge.tsx**

- Remove local `useState` for `project` and `tab`.
- Project: read `selectedProject`; `active = selectedProject ?? projects.data?.[0]?.name ?? null`.
  The dropdown's `onValueChange` calls `setSelectedProject(name)`.
- Tab: read `tabsBySection.knowledge`, defaulting to `browse`; tab buttons call
  `setTab('knowledge', id)`. Guard the read against an invalid persisted id.

**Productivity.tsx**

- Remove local `tab` useState → `tabsBySection.productivity` (default `overview`);
  tab buttons call `setTab('productivity', id)`.
- Project: derive `projectPath` from the global name each render:
  `const matched = projectList.find((p) => p.project === selectedProject)`;
  `projectPath = matched?.projectPath` (undefined ⇒ all projects).
  - Selecting a specific project → `setSelectedProject(p.project)`.
  - Selecting "all projects" → `setSelectedProject(null)`.
- `days` range stays local component state (not persisted).
- **Remove the `days` `.seg` range selector on the Benchmark tab.** Render it only when
  the active tab is one that consumes `days` (`overview`, `sessions`, `ecosystem`); on
  `benchmark` it is not rendered. (Overview, Sessions, Ecosystem genuinely use `days`;
  Benchmark queries are global/unwindowed. The Ecosystem "Change Impact" sub-panel uses
  a fixed internal window unrelated to this header selector and is left untouched.)

**News.tsx**

- The feed tabs (`ai-news` / `trending`) persist via `tabsBySection.news`, defaulting to
  `ai-news`. The active-feed state reads/writes the store with an invalid-id guard.

**App.tsx / navigation**

- `section` already drives routing via the store; persistence now makes the last section
  reopen on load. Keyboard shortcuts and the sidebar continue to call `setSection`
  unchanged. zustand `persist` rehydrates synchronously, so the correct page/tab/project
  render on first paint (no flash-then-jump).

## Error handling / edge cases

- Corrupt or partial localStorage payload → `merge`/version guard resets to valid
  defaults rather than throwing.
- Persisted `section` or tab id no longer exists (renamed across versions) → falls back
  to defaults via the validation guards.
- Global project name not present on the current page's list → Knowledge shows first
  project, Productivity shows all projects; the stored name is preserved for pages that
  do have it.

## Testing

- **Store unit test:** set `section` / `selectedProject` / `tab` and assert the persisted
  payload shape; rehydrate a payload with a bogus `section` and a bogus tab id and assert
  fallbacks to `dashboard` / page defaults.
- **e2e (existing Playwright pattern):** switch to Knowledge `./graph`, pick a project,
  reload; assert the section, tab, and project are restored. Switch the Productivity tab
  to `benchmark` and assert the `days` range buttons are not present.

## Files touched

- `src/renderer/src/store/ui.ts` — persist middleware + new state/actions.
- `src/renderer/src/pages/Knowledge.tsx` — use global project + persisted tab.
- `src/renderer/src/pages/Productivity.tsx` — global project, persisted tab, conditional
  `days` selector.
- `src/renderer/src/pages/News.tsx` — persisted feed tab.
- Tests: store unit test + e2e additions.

No backend, shared schema, or router changes.
