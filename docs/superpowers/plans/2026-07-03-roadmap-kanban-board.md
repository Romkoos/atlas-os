# ROADMAP Kanban Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Jira-style status-column Kanban board to the ROADMAP page (drag-and-drop between columns), rename status `idea`→`todo`, and add a persisted "hide done" toggle — keeping the existing category List view intact.

**Architecture:** UI-forward change. The only backend change is the `idea`→`todo` rename plus a guarded one-time data migration (same electron-store flag pattern as the existing `claudePromptBackfilled`). The renderer gains a List⇄Board view toggle (via the existing `tabsBySection` store), a new `RoadmapBoard` (@dnd-kit), a unified `RoadmapDetail` panel that replaces the old edit modal, and an extracted `RoadmapList`. In-column card order is auto-derived (priority then recency) — `position` is never touched by the board.

**Tech Stack:** Electron + React + TypeScript + tRPC + Drizzle/better-sqlite3 + zustand + @dnd-kit/core (new) + Vitest + Playwright (e2e) + Biome.

## Global Constraints

- All UI strings and code identifiers are **English** (only generated digest content may be non-English). Verbatim from repo convention.
- Statuses after this change: `['todo', 'planned', 'in-progress', 'done']`; label for `todo` is `'To do'`.
- Categories unchanged: `intelligence | observability | macos | connectivity | wow`.
- Priorities unchanged: `low | medium | high`.
- `position` semantics are unchanged: manual order **within a category**, List-view only. The board never reads or writes `position`.
- No new DB tables (Comments/Activity are visual placeholders only).
- Follow existing patterns: guarded one-time ops use the `roadmap-meta` electron-store flags; DB-backed tests use an in-memory `better-sqlite3` + `migrate(db, { migrationsFolder: 'drizzle' })` harness (see `src/main/services/graph/store.test.ts`).
- Renderer stays sandboxed; all Node/DB work is in `src/main`.
- Run `pnpm lint` (Biome) and `pnpm typecheck` before each commit; both must be clean for files this plan touches. (Pre-existing `any` warnings in `Galaxy3D.tsx` / `d3-force-3d.d.ts` are unrelated and may remain.)

---

## File Structure

**Modified:**
- `src/shared/roadmap.ts` — status enum + labels + create default (Task 1)
- `src/shared/roadmap.test.ts` — update default expectation (Task 1)
- `src/main/db/schema.ts` — column default `'idea'`→`'todo'` (Task 1)
- `src/main/services/roadmap/store.ts` — seed status, create default, migration fn + meta flag (Tasks 1, 2)
- `src/main/index.ts` — call the migration at startup (Task 2)
- `src/renderer/src/store/ui.ts` — `roadmapHideDone` persisted flag (Task 3)
- `src/renderer/src/store/ui.test.ts` — coercion test (Task 3)
- `src/renderer/src/pages/Roadmap.tsx` — becomes the orchestrator (Tasks 5, 6, 7)
- `src/renderer/src/index.css` — rename `st-idea`→`st-todo`, board + detail styles (Tasks 1, 5, 6)
- `e2e/app.spec.ts` — board smoke test (Task 8)

**Created:**
- `drizzle/00XX_*.sql` — generated migration for the schema default change (Task 1)
- `src/main/services/roadmap/store.test.ts` — migration unit test (Task 2)
- `src/renderer/src/pages/roadmap/board-utils.ts` — pure grouping/sort/filter helpers (Task 4)
- `src/renderer/src/pages/roadmap/board-utils.test.ts` — helper tests (Task 4)
- `src/renderer/src/pages/roadmap/RoadmapBoard.tsx` — the board (Task 5)
- `src/renderer/src/pages/roadmap/RoadmapDetail.tsx` — unified detail/edit panel (Task 6)
- `src/renderer/src/pages/roadmap/RoadmapList.tsx` — extracted List view (Task 7)

---

## Task 1: Rename status `idea` → `todo`

Rename the status everywhere it is referenced so the app compiles and behaves exactly as before, only with the new key/label. (Existing rows are migrated in Task 2.)

**Files:**
- Modify: `src/shared/roadmap.ts:14`, `:30-35`, `:64`
- Modify: `src/shared/roadmap.test.ts:47-52`
- Modify: `src/main/db/schema.ts:198`
- Modify: `src/main/services/roadmap/store.ts:57`, `:119`
- Modify: `src/renderer/src/pages/Roadmap.tsx:22-27`, `:407-411` (KPI label)
- Modify: `src/renderer/src/index.css:3167` (segment color selector)
- Create (generated): `drizzle/00XX_*.sql`

**Interfaces:**
- Produces: `ROADMAP_STATUSES = ['todo','planned','in-progress','done'] as const`; `STATUS_LABELS.todo === 'To do'`; `roadmapCreateSchema` default `status: 'todo'`. Consumed by every later task.

- [ ] **Step 1: Update the existing default test to expect `todo`**

In `src/shared/roadmap.test.ts`, the "applies defaults for optional fields" case (line ~44) currently expects `status: 'idea'`. Change it:

```ts
  it('applies defaults for optional fields', () => {
    const minimal = { title: 'X', category: 'wow' }
    const parsed = parseRoadmapProposal(wrap(JSON.stringify(minimal)))
    expect(parsed).toMatchObject({
      title: 'X',
      category: 'wow',
      status: 'todo',
      priority: 'medium',
      description: '',
      claudePrompt: '',
    })
  })
```

- [ ] **Step 2: Run the test to verify it now fails**

Run: `pnpm vitest run src/shared/roadmap.test.ts`
Expected: FAIL — the "applies defaults" case gets `status: 'idea'`, not `'todo'`.

- [ ] **Step 3: Rename the status in shared types**

In `src/shared/roadmap.ts`:

```ts
export const ROADMAP_STATUSES = ['todo', 'planned', 'in-progress', 'done'] as const
```

Replace the `idea` entry in `STATUS_LABELS`:

```ts
export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  todo: 'To do',
  planned: 'Planned',
  'in-progress': 'In progress',
  done: 'Done',
}
```

In `roadmapCreateSchema`, change the status default:

```ts
  status: z.enum(ROADMAP_STATUSES).default('todo'),
```

- [ ] **Step 4: Update the DB column default + comment**

In `src/main/db/schema.ts:198`:

```ts
    status: text('status').notNull().default('todo'), // todo | planned | in-progress | done
```

- [ ] **Step 5: Update the store seed status and create default**

In `src/main/services/roadmap/store.ts`, the seed insert (line ~57):

```ts
      status: 'todo' as const,
```

And `createRoadmapItem` (line ~119):

```ts
    status: input.status ?? 'todo',
```

- [ ] **Step 6: Update the renderer segmented switch + KPI label**

In `src/renderer/src/pages/Roadmap.tsx`, the `SEGMENTS` array (line ~22):

```ts
const SEGMENTS: { status: RoadmapStatus; label: string; cls: string }[] = [
  { status: 'todo', label: 'To do', cls: 'st-todo' },
  { status: 'planned', label: 'Plan', cls: 'st-planned' },
  { status: 'in-progress', label: 'Active', cls: 'st-active' },
  { status: 'done', label: 'Done', cls: 'st-done' },
]
```

In the KPI row (line ~407), rename the `idea` KPI to `to do`:

```tsx
            <div className="kpi">
              <div className="label">to do</div>
              <div className="val">{count('todo')}</div>
            </div>
```

- [ ] **Step 7: Rename the CSS segment color selector**

In `src/renderer/src/index.css:3167`, rename the selector:

```css
.rm-seg button.on.st-todo {
  color: var(--fg-2);
}
```

- [ ] **Step 8: Generate the Drizzle migration for the default change**

Run: `pnpm db:generate`
Expected: a new `drizzle/00XX_*.sql` file (default change), OR the message "No schema changes detected". Either outcome is acceptable — inserts always pass an explicit status, so the DB-level default is cosmetic. If a file is generated, keep it.

- [ ] **Step 9: Run tests + typecheck + lint**

Run: `pnpm vitest run src/shared/roadmap.test.ts && pnpm typecheck && pnpm lint`
Expected: roadmap tests PASS; typecheck clean; lint clean (aside from the pre-existing unrelated `any` warnings).

- [ ] **Step 10: Commit**

```bash
git add src/shared/roadmap.ts src/shared/roadmap.test.ts src/main/db/schema.ts \
  src/main/services/roadmap/store.ts src/renderer/src/pages/Roadmap.tsx \
  src/renderer/src/index.css drizzle
git commit -m "feat(roadmap): rename status idea→todo

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: One-time `idea`→`todo` data migration

Existing DB rows still hold `status='idea'`. Add a guarded, idempotent migration that rewrites them, run at startup next to the existing seed/backfill.

**Files:**
- Modify: `src/main/services/roadmap/store.ts:14-27` (meta interface/defaults), add exported functions near `backfillRoadmapClaudePrompts`
- Modify: `src/main/index.ts:8`, `:39-40`
- Create: `src/main/services/roadmap/store.test.ts`

**Interfaces:**
- Consumes: `AppDatabase` from `@main/db/client`; `roadmapItems` from `@main/db/schema`.
- Produces: `runIdeaToTodoUpdate(database: AppDatabase): number` (pure; returns rows changed) and `migrateStatusIdeaToTodoIfNeeded(): void` (guarded wrapper using the global `db()` + meta flag).

- [ ] **Step 1: Write the failing migration test**

Create `src/main/services/roadmap/store.test.ts`:

```ts
import { randomUUID } from 'node:crypto'
import * as schema from '@main/db/schema'
import { roadmapItems } from '@main/db/schema'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { runIdeaToTodoUpdate } from './store'

function testDb() {
  const sqlite = new Database(':memory:')
  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: 'drizzle' })
  return database
}

function insert(db: ReturnType<typeof testDb>, status: string) {
  const now = new Date()
  const id = randomUUID()
  db.insert(roadmapItems)
    .values({
      id,
      title: 't',
      description: '',
      category: 'wow',
      status,
      priority: 'medium',
      claudePrompt: '',
      position: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

describe('runIdeaToTodoUpdate', () => {
  it('rewrites idea rows to todo and leaves others untouched', () => {
    const db = testDb()
    const ideaId = insert(db, 'idea')
    const plannedId = insert(db, 'planned')

    const changed = runIdeaToTodoUpdate(db)

    expect(changed).toBe(1)
    expect(db.select().from(roadmapItems).where(eq(roadmapItems.id, ideaId)).get()?.status).toBe(
      'todo',
    )
    expect(
      db.select().from(roadmapItems).where(eq(roadmapItems.id, plannedId)).get()?.status,
    ).toBe('planned')
  })

  it('is a no-op when there are no idea rows', () => {
    const db = testDb()
    insert(db, 'todo')
    expect(runIdeaToTodoUpdate(db)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/main/services/roadmap/store.test.ts`
Expected: FAIL — `runIdeaToTodoUpdate` is not exported.

- [ ] **Step 3: Add the meta flag**

In `src/main/services/roadmap/store.ts`, extend `RoadmapMeta` and its defaults:

```ts
interface RoadmapMeta {
  seeded: boolean
  claudePromptBackfilled: boolean
  statusIdeaToTodoMigrated: boolean
}
```

```ts
    metaStore = new Store<RoadmapMeta>({
      name: 'roadmap-meta',
      defaults: { seeded: false, claudePromptBackfilled: false, statusIdeaToTodoMigrated: false },
    })
```

- [ ] **Step 4: Implement the migration functions**

Add near `backfillRoadmapClaudePrompts`. Add the `AppDatabase` import at the top (`import type { AppDatabase } from '@main/db/client'`):

```ts
// Pure DB step: rewrite legacy status='idea' rows to 'todo'. Returns rows changed.
export function runIdeaToTodoUpdate(database: AppDatabase): number {
  const res = database
    .update(roadmapItems)
    .set({ status: 'todo' })
    .where(eq(roadmapItems.status, 'idea'))
    .run()
  return res.changes
}

// One-time migration for the idea→todo rename. Guarded by a meta flag AND scoped
// to idea rows, so it is safe to call on every startup.
export function migrateStatusIdeaToTodoIfNeeded(): void {
  if (meta().get('statusIdeaToTodoMigrated')) return
  const changed = runIdeaToTodoUpdate(db())
  if (changed > 0) logger.info('Roadmap status idea→todo migrated', { count: changed })
  meta().set('statusIdeaToTodoMigrated', true)
}
```

(`eq` is already imported from `drizzle-orm` in this file; `db`, `roadmapItems`, `logger` are already imported.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/main/services/roadmap/store.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Wire the migration into startup**

In `src/main/index.ts`, extend the import (line 8) and the call site (lines 39-40):

```ts
import {
  backfillRoadmapClaudePrompts,
  migrateStatusIdeaToTodoIfNeeded,
  seedRoadmapIfNeeded,
} from '@main/services/roadmap/store'
```

```ts
    seedRoadmapIfNeeded()
    backfillRoadmapClaudePrompts()
    migrateStatusIdeaToTodoIfNeeded()
```

- [ ] **Step 7: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/roadmap/store.ts src/main/services/roadmap/store.test.ts src/main/index.ts
git commit -m "feat(roadmap): one-time idea→todo status migration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Persisted `roadmapHideDone` UI flag

**Files:**
- Modify: `src/renderer/src/store/ui.ts`
- Modify: `src/renderer/src/store/ui.test.ts`

**Interfaces:**
- Produces: `useUiStore` gains `roadmapHideDone: boolean` (default `false`) + `setRoadmapHideDone: (v: boolean) => void`, both persisted. `mergePersistedUi` coerces a non-boolean/absent value to `false`.

- [ ] **Step 1: Write the failing coercion test**

Append to `src/renderer/src/store/ui.test.ts` inside the `describe('mergePersistedUi', …)` block:

```ts
  it('defaults roadmapHideDone to false when absent', () => {
    const out = mergePersistedUi({ section: 'roadmap' }, base)
    expect(out.roadmapHideDone).toBe(false)
  })

  it('coerces a non-boolean roadmapHideDone to false', () => {
    const out = mergePersistedUi({ roadmapHideDone: 'yes' }, base)
    expect(out.roadmapHideDone).toBe(false)
  })

  it('preserves a true roadmapHideDone', () => {
    const out = mergePersistedUi({ roadmapHideDone: true }, base)
    expect(out.roadmapHideDone).toBe(true)
  })
```

Note: `base` is the existing test fixture (`useUiStore.getState()` snapshot) already defined at the top of this file — reuse it as the other cases do.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/renderer/src/store/ui.test.ts`
Expected: FAIL — `roadmapHideDone` is `undefined` on the merged output.

- [ ] **Step 3: Add the field to the store**

In `src/renderer/src/store/ui.ts`:

Extend `UiState`:

```ts
interface UiState {
  section: Section
  selectedProject: string | null
  tabsBySection: Partial<Record<Section, string>>
  roadmapHideDone: boolean
  setSection: (section: Section) => void
  setSelectedProject: (project: string | null) => void
  setTab: (section: Section, tab: string) => void
  setRoadmapHideDone: (v: boolean) => void
}
```

In `mergePersistedUi`, coerce and return the field:

```ts
  const roadmapHideDone = typeof p.roadmapHideDone === 'boolean' ? p.roadmapHideDone : false
  return { ...current, section, selectedProject, tabsBySection, roadmapHideDone }
```

Widen the `guardedStorage` pick type and `partialize` to include the field:

```ts
const guardedStorage = createJSONStorage<
  Pick<UiState, 'section' | 'selectedProject' | 'tabsBySection' | 'roadmapHideDone'>
>(() => (typeof localStorage !== 'undefined' ? localStorage : noopStorage))
```

In the store initializer, add the default + setter:

```ts
      section: 'dashboard',
      selectedProject: null,
      tabsBySection: {},
      roadmapHideDone: false,
      setSection: (section) => set({ section }),
      setSelectedProject: (selectedProject) => set({ selectedProject }),
      setTab: (section, tab) =>
        set((s) => ({ tabsBySection: { ...s.tabsBySection, [section]: tab } })),
      setRoadmapHideDone: (roadmapHideDone) => set({ roadmapHideDone }),
```

And in `partialize`:

```ts
      partialize: (s) => ({
        section: s.section,
        selectedProject: s.selectedProject,
        tabsBySection: s.tabsBySection,
        roadmapHideDone: s.roadmapHideDone,
      }),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/renderer/src/store/ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/renderer/src/store/ui.ts src/renderer/src/store/ui.test.ts
git commit -m "feat(roadmap): persisted roadmapHideDone ui flag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Board pure helpers (`board-utils.ts`)

Grouping/sorting/filtering logic extracted as pure functions so it is unit-testable independent of DnD/React.

**Files:**
- Create: `src/renderer/src/pages/roadmap/board-utils.ts`
- Create: `src/renderer/src/pages/roadmap/board-utils.test.ts`

**Interfaces:**
- Produces:
  - `type CategoryFilter = 'all' | RoadmapCategory`
  - `hideDoneFilter(items: RoadmapItem[], hideDone: boolean): RoadmapItem[]`
  - `filterByCategory(items: RoadmapItem[], filter: CategoryFilter): RoadmapItem[]`
  - `sortColumnItems(items: RoadmapItem[]): RoadmapItem[]` (priority High→Low, then `updatedAt` desc; pure/non-mutating)
  - `groupByStatus(items: RoadmapItem[]): Record<RoadmapStatus, RoadmapItem[]>`
  - `CATEGORY_SHORT: Record<RoadmapCategory, string>`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/pages/roadmap/board-utils.test.ts`:

```ts
import type { RoadmapItem } from '@shared/roadmap'
import { describe, expect, it } from 'vitest'
import {
  filterByCategory,
  groupByStatus,
  hideDoneFilter,
  sortColumnItems,
} from './board-utils'

function item(over: Partial<RoadmapItem>): RoadmapItem {
  return {
    id: 'id',
    title: 't',
    description: '',
    category: 'wow',
    status: 'todo',
    priority: 'medium',
    claudePrompt: '',
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('hideDoneFilter', () => {
  it('drops done items only when hideDone is true', () => {
    const items = [item({ id: 'a', status: 'done' }), item({ id: 'b', status: 'todo' })]
    expect(hideDoneFilter(items, true).map((i) => i.id)).toEqual(['b'])
    expect(hideDoneFilter(items, false).map((i) => i.id)).toEqual(['a', 'b'])
  })
})

describe('filterByCategory', () => {
  it("returns all items for 'all'", () => {
    const items = [item({ category: 'wow' }), item({ category: 'macos' })]
    expect(filterByCategory(items, 'all')).toHaveLength(2)
  })
  it('filters to a single category', () => {
    const items = [item({ id: 'a', category: 'wow' }), item({ id: 'b', category: 'macos' })]
    expect(filterByCategory(items, 'macos').map((i) => i.id)).toEqual(['b'])
  })
})

describe('sortColumnItems', () => {
  it('orders by priority High→Low then most-recently-updated', () => {
    const items = [
      item({ id: 'lowNew', priority: 'low', updatedAt: 100 }),
      item({ id: 'highOld', priority: 'high', updatedAt: 1 }),
      item({ id: 'highNew', priority: 'high', updatedAt: 50 }),
      item({ id: 'medMid', priority: 'medium', updatedAt: 10 }),
    ]
    expect(sortColumnItems(items).map((i) => i.id)).toEqual([
      'highNew',
      'highOld',
      'medMid',
      'lowNew',
    ])
  })
  it('does not mutate its input', () => {
    const items = [item({ id: 'a', priority: 'low' }), item({ id: 'b', priority: 'high' })]
    const before = items.map((i) => i.id)
    sortColumnItems(items)
    expect(items.map((i) => i.id)).toEqual(before)
  })
})

describe('groupByStatus', () => {
  it('buckets items into all four status keys', () => {
    const grouped = groupByStatus([item({ status: 'todo' }), item({ status: 'done' })])
    expect(grouped.todo).toHaveLength(1)
    expect(grouped.done).toHaveLength(1)
    expect(grouped.planned).toEqual([])
    expect(grouped['in-progress']).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/renderer/src/pages/roadmap/board-utils.test.ts`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 3: Implement the helpers**

Create `src/renderer/src/pages/roadmap/board-utils.ts`:

```ts
import {
  ROADMAP_STATUSES,
  type RoadmapCategory,
  type RoadmapItem,
  type RoadmapPriority,
  type RoadmapStatus,
} from '@shared/roadmap'

export type CategoryFilter = 'all' | RoadmapCategory

const PRIORITY_RANK: Record<RoadmapPriority, number> = { high: 0, medium: 1, low: 2 }

// Short badge labels for the card's category chip.
export const CATEGORY_SHORT: Record<RoadmapCategory, string> = {
  intelligence: 'INT',
  observability: 'OBS',
  macos: 'MAC',
  connectivity: 'CONN',
  wow: 'WOW',
}

export function hideDoneFilter(items: RoadmapItem[], hideDone: boolean): RoadmapItem[] {
  return hideDone ? items.filter((i) => i.status !== 'done') : items
}

export function filterByCategory(items: RoadmapItem[], filter: CategoryFilter): RoadmapItem[] {
  return filter === 'all' ? items : items.filter((i) => i.category === filter)
}

// Priority High→Low, then most-recently-updated first. Non-mutating.
export function sortColumnItems(items: RoadmapItem[]): RoadmapItem[] {
  return [...items].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt - a.updatedAt,
  )
}

export function groupByStatus(items: RoadmapItem[]): Record<RoadmapStatus, RoadmapItem[]> {
  const groups = Object.fromEntries(ROADMAP_STATUSES.map((s) => [s, []])) as Record<
    RoadmapStatus,
    RoadmapItem[]
  >
  for (const item of items) groups[item.status].push(item)
  return groups
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/renderer/src/pages/roadmap/board-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`

```bash
git add src/renderer/src/pages/roadmap/board-utils.ts src/renderer/src/pages/roadmap/board-utils.test.ts
git commit -m "feat(roadmap): pure board grouping/sort/filter helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `RoadmapBoard` component + @dnd-kit + board CSS

A props-driven board. Not yet mounted (wired up in Task 7), so it compiles standalone.

**Files:**
- Create: `src/renderer/src/pages/roadmap/RoadmapBoard.tsx`
- Modify: `src/renderer/src/index.css` (append board styles)
- Modify: `package.json` (add `@dnd-kit/core`)

**Interfaces:**
- Consumes: `board-utils` (Task 4); `STATUS_LABELS`, `ROADMAP_STATUSES`, types from `@shared/roadmap`; `CATEGORY_LABELS`.
- Produces: `export function RoadmapBoard(props: RoadmapBoardProps)` where
  ```ts
  interface RoadmapBoardProps {
    items: RoadmapItem[]
    hideDone: boolean
    onCardClick: (item: RoadmapItem) => void
    onStatusChange: (id: string, status: RoadmapStatus) => void
    onCopy: (text: string) => void
  }
  ```

- [ ] **Step 1: Add the @dnd-kit dependency**

Run: `pnpm add @dnd-kit/core`
Expected: `@dnd-kit/core` appears in `package.json` dependencies and installs cleanly.

- [ ] **Step 2: Implement the board component**

Create `src/renderer/src/pages/roadmap/RoadmapBoard.tsx`:

```tsx
import {
  CATEGORY_LABELS,
  ROADMAP_CATEGORIES,
  ROADMAP_STATUSES,
  type RoadmapItem,
  type RoadmapStatus,
  STATUS_LABELS,
} from '@shared/roadmap'
import { TermSelect } from '@renderer/components/ui/select'
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { Copy } from 'lucide-react'
import { useState } from 'react'
import {
  type CategoryFilter,
  CATEGORY_SHORT,
  filterByCategory,
  groupByStatus,
  sortColumnItems,
} from './board-utils'

const PRIO_CLASS: Record<RoadmapItem['priority'], string> = {
  high: 'p-high',
  medium: 'p-med',
  low: 'p-low',
}
const PRIO_SHORT: Record<RoadmapItem['priority'], string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
}

const categoryFilterOptions = [
  { value: 'all', label: 'All categories' },
  ...ROADMAP_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
]

function Card({
  item,
  onClick,
  onCopy,
  overlay = false,
}: {
  item: RoadmapItem
  onClick?: () => void
  onCopy?: () => void
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id })
  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`rm-card ${PRIO_CLASS[item.priority]}${isDragging ? ' dragging' : ''}${overlay ? ' overlay' : ''}`}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={onClick}
    >
      <div className="rm-card-title">{item.title}</div>
      <div className="rm-card-foot">
        <span className="rm-cat-badge">{CATEGORY_SHORT[item.category]}</span>
        <span className={`rm-card-prio ${PRIO_CLASS[item.priority]}`}>
          {PRIO_SHORT[item.priority]}
        </span>
        {item.claudePrompt ? (
          <button
            type="button"
            className="rm-icon rm-card-copy"
            aria-label="Copy Claude Code prompt"
            title="Copy Claude Code prompt"
            // Stop the drag/click-open handlers from also firing.
            onClick={(e) => {
              e.stopPropagation()
              onCopy?.()
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Copy size={13} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Column({
  status,
  count,
  collapsed,
  children,
}: {
  status: RoadmapStatus
  count: number
  collapsed: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={`rm-col${collapsed ? ' collapsed' : ''}${isOver ? ' over' : ''}`}
    >
      <div className="rm-col-head">
        <span className="rm-col-ttl">{STATUS_LABELS[status]}</span>
        <span className="rm-col-count">{count}</span>
      </div>
      {collapsed ? null : <div className="rm-cards">{children}</div>}
    </div>
  )
}

export interface RoadmapBoardProps {
  items: RoadmapItem[]
  hideDone: boolean
  onCardClick: (item: RoadmapItem) => void
  onStatusChange: (id: string, status: RoadmapStatus) => void
  onCopy: (text: string) => void
}

export function RoadmapBoard({
  items,
  hideDone,
  onCardClick,
  onStatusChange,
  onCopy,
}: RoadmapBoardProps) {
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [activeId, setActiveId] = useState<string | null>(null)
  // A small drag threshold lets plain clicks through to onCardClick.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const visible = filterByCategory(items, category)
  const grouped = groupByStatus(visible)
  const activeItem = activeId ? items.find((i) => i.id === activeId) ?? null : null

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const item = items.find((i) => i.id === active.id)
    const target = over.id as RoadmapStatus
    if (!item || item.status === target) return
    onStatusChange(String(active.id), target)
  }

  return (
    <div className="rm-board-wrap">
      <div className="rm-board-toolbar">
        <TermSelect
          value={category}
          onValueChange={(v) => setCategory(v as CategoryFilter)}
          options={categoryFilterOptions}
        />
      </div>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="rm-board">
          {ROADMAP_STATUSES.map((status) => {
            const colItems = sortColumnItems(grouped[status])
            const collapsed = status === 'done' && hideDone
            return (
              <Column
                key={status}
                status={status}
                count={colItems.length}
                collapsed={collapsed}
              >
                {colItems.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    onClick={() => onCardClick(item)}
                    onCopy={() => onCopy(item.claudePrompt)}
                  />
                ))}
              </Column>
            )
          })}
        </div>
        <DragOverlay>{activeItem ? <Card item={activeItem} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
```

Note: copy is delegated to the `onCopy` prop (the orchestrator owns the `copyText` mutation, same as the List) — the board does no tRPC itself.

- [ ] **Step 3: Append board CSS**

Append to `src/renderer/src/index.css`:

```css
/* ── Roadmap board (Kanban) ────────────────────────────────────────────────── */
.rm-board-toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
.rm-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}
.rm-col {
  border: 1px solid var(--line);
  background: var(--bg-2);
  min-height: 120px;
  transition: border-color 0.12s, background 0.12s;
}
.rm-col.over {
  border-color: var(--amber);
  background: color-mix(in oklch, var(--amber) 6%, var(--bg-2));
}
.rm-col.collapsed {
  min-height: 0;
  opacity: 0.6;
}
.rm-col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--line-dim);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-3);
}
.rm-col-count {
  color: var(--fg-4);
  font-variant-numeric: tabular-nums;
}
.rm-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  min-height: 40px;
}
.rm-card {
  border: 1px solid var(--line);
  border-left: 2px solid transparent;
  background: var(--panel-2);
  padding: 10px 11px;
  cursor: grab;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.12s, background 0.12s;
}
.rm-card:hover {
  border-color: var(--line);
  background: var(--bg-2);
}
.rm-card.p-high {
  border-left-color: var(--amber);
}
.rm-card.p-med {
  border-left-color: var(--amber-dim);
}
.rm-card.p-low {
  border-left-color: var(--line);
}
.rm-card.dragging {
  opacity: 0.4;
}
.rm-card.overlay {
  cursor: grabbing;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.rm-card-title {
  font-family: var(--mono);
  font-size: 12.5px;
  color: var(--fg);
  line-height: 1.4;
}
.rm-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rm-cat-badge {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--fg-4);
  border: 1px solid var(--line-dim);
  padding: 1px 5px;
}
.rm-card-prio {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--fg-4);
  margin-left: auto;
}
.rm-card-prio.p-high {
  color: var(--amber);
}
.rm-card-prio.p-med {
  color: var(--amber-dim);
}
.rm-card-copy {
  width: 22px;
  height: 22px;
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean (the component is exported but unused for now — that is fine).

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/src/pages/roadmap/RoadmapBoard.tsx src/renderer/src/index.css
git commit -m "feat(roadmap): RoadmapBoard component with @dnd-kit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Unified `RoadmapDetail` panel (replaces `RoadmapEditor`)

Move the current edit modal into its own file, rename it, add a two-column layout with placeholder Comments/Activity sections (shown only in edit mode), and swap the Roadmap page over to it.

**Files:**
- Create: `src/renderer/src/pages/roadmap/RoadmapDetail.tsx`
- Modify: `src/renderer/src/pages/Roadmap.tsx` (remove the inline `RoadmapEditor`, import + use `RoadmapDetail`)
- Modify: `src/renderer/src/index.css` (append detail styles)

**Interfaces:**
- Consumes: `trpc` mutations `roadmap.create` / `roadmap.update`; `TermSelect`; shared roadmap types/labels.
- Produces: `export function RoadmapDetail({ item, onClose, onSaved }: { item: RoadmapItem | null | undefined; onClose: () => void; onSaved: () => void })`. Same open/create/edit contract as today's `RoadmapEditor` (`undefined` = closed, `null` = create, item = edit).

- [ ] **Step 1: Create the detail component**

Create `src/renderer/src/pages/roadmap/RoadmapDetail.tsx` by moving the existing `RoadmapEditor` body (`src/renderer/src/pages/Roadmap.tsx:58-225`) into it, renamed to `RoadmapDetail`, keeping all existing field logic (`Draft`, `EMPTY_DRAFT`, the create/update mutations, Escape handling, save()). Then wrap the existing body fields in a left column and add a right column with placeholders. The changed region is the returned modal body — replace the single `rm-modal-body` block with:

```tsx
        <div className="rm-modal-body rm-detail-grid">
          <div className="rm-detail-main">
            {/* — existing fields unchanged: Title, Description, Category/Status/Priority
                 grid, Claude Code prompt — moved here verbatim from RoadmapEditor — */}
          </div>
          {item ? (
            <div className="rm-detail-side">
              <div className="rm-detail-section">
                <span className="rm-field-label">Comments</span>
                <div className="rm-placeholder">{'// comes with the Atlas agent'}</div>
              </div>
              <div className="rm-detail-section">
                <span className="rm-field-label">Activity</span>
                <div className="rm-placeholder">{'// comes with the Atlas agent'}</div>
              </div>
            </div>
          ) : null}
        </div>
```

Keep everything else (`rm-backdrop`, `rm-modal-head`, `rm-modal-foot`, imports of `CATEGORY_LABELS`, `TermSelect`, `trpc`, `toast`, `useEffect`, `useState`) identical. Add `import type { RoadmapItem, ... }` from `@shared/roadmap` as needed. The full field markup is exactly the current `RoadmapEditor` — copy it verbatim into `rm-detail-main`.

- [ ] **Step 2: Swap the page over to `RoadmapDetail`**

In `src/renderer/src/pages/Roadmap.tsx`:
- Delete the inline `RoadmapEditor` function (lines ~58-225) and the now-unused imports it solely used (keep any still referenced by the page).
- Add: `import { RoadmapDetail } from './roadmap/RoadmapDetail'`.
- Replace the `<RoadmapEditor ... />` usage at the bottom with `<RoadmapDetail ... />` (same props).

- [ ] **Step 3: Append detail CSS**

Append to `src/renderer/src/index.css`:

```css
/* ── Roadmap detail panel (two-column) ─────────────────────────────────────── */
.rm-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: 20px;
}
.rm-detail-main {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.rm-detail-side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-left: 1px solid var(--line-dim);
  padding-left: 20px;
}
.rm-detail-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rm-placeholder {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--fg-4);
  border: 1px dashed var(--line-dim);
  padding: 14px;
  text-align: center;
}
@media (max-width: 720px) {
  .rm-detail-grid {
    grid-template-columns: 1fr;
  }
  .rm-detail-side {
    border-left: 0;
    padding-left: 0;
    border-top: 1px solid var(--line-dim);
    padding-top: 16px;
  }
}
```

Widen the modal if needed: locate `.rm-modal` (`index.css:3257`) and add/raise its `max-width` (e.g. `min(880px, 92vw)`) so the two columns have room. Keep the existing centering.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. No dead references to `RoadmapEditor`.

- [ ] **Step 5: Manually verify the List view still edits**

Run: `pnpm dev` (or the project's run skill). Open ROADMAP, click a row's edit (pencil) — the detail panel opens with the two-column layout, Comments/Activity placeholders on the right, fields editable, save works. Escape/cancel close it. Stop the app.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/roadmap/RoadmapDetail.tsx src/renderer/src/pages/Roadmap.tsx src/renderer/src/index.css
git commit -m "feat(roadmap): unified detail panel replaces edit modal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Orchestrate — extract `RoadmapList`, add view toggle + hide-done, mount board

Turn `Roadmap.tsx` into the orchestrator: it owns data + the shared `RoadmapDetail`, and renders either `RoadmapList` or `RoadmapBoard` based on the persisted tab, with a Hide-done switch.

**Files:**
- Create: `src/renderer/src/pages/roadmap/RoadmapList.tsx`
- Modify: `src/renderer/src/pages/Roadmap.tsx`

**Interfaces:**
- Consumes: `useUiStore` (`tabsBySection.roadmap`, `setTab`, `roadmapHideDone`, `setRoadmapHideDone` — Task 3); `RoadmapBoard` (Task 5); `hideDoneFilter` (Task 4).
- `RoadmapList` produces: `export function RoadmapList({ items, onEdit, onStatus, onDelete, onCopy }: RoadmapListProps)` — the current category-grouped body (KPI row + category sections + `ItemRow` + `StatusSwitch`), moved out of `Roadmap.tsx` verbatim. Its `items` prop is already hide-done-filtered by the orchestrator.

- [ ] **Step 1: Extract `RoadmapList`**

Create `src/renderer/src/pages/roadmap/RoadmapList.tsx`. Move `StatusSwitch`, `ItemRow`, the `SEGMENTS`/`PRIO_CLASS`/`PRIO_SHORT` consts, and the category-grouping + KPI render (currently inside `Roadmap`'s return, the `kpis`/`rm-stack` blocks) into a `RoadmapList` component with this signature:

```tsx
interface RoadmapListProps {
  items: RoadmapItem[]
  onEdit: (item: RoadmapItem) => void
  onStatus: (id: string, status: RoadmapStatus) => void
  onDelete: (id: string) => void
  onCopy: (text: string) => void
}
```

The KPI counts (`count('todo')` etc.) and the `byCategory` grouping computed from `items` move into `RoadmapList`. Behavior stays identical to today's list (including the running index). The empty-state (`rm-empty`) for "no items" stays in the orchestrator (it depends on load state), OR move it in — keep it wherever is simplest as long as an empty list still shows the hint.

**Signature adaptation:** today's inner `ItemRow`/`StatusSwitch` `onStatus` takes a single `status` arg (the item id is captured in the page closure). Since `RoadmapList` no longer owns the mutation, its `onStatus` prop is `(id, status)`. Adapt the `ItemRow` usage inside `RoadmapList` accordingly, e.g. `onStatus={(status) => onStatus(item.id, status)}`, and likewise pass `item.id` to `onDelete`/`item.claudePrompt` to `onCopy`. Keep `ItemRow`'s own internal prop shape unchanged.

- [ ] **Step 2: Rewrite `Roadmap.tsx` as the orchestrator**

`Roadmap.tsx` keeps the tRPC queries/mutations (`list`, optimistic `update`, `remove`, `copyText`) and the `RoadmapDetail` state. Add view + hide-done wiring:

```tsx
import { useUiStore } from '@renderer/store/ui'
import { RoadmapBoard } from './roadmap/RoadmapBoard'
import { RoadmapList } from './roadmap/RoadmapList'
import { hideDoneFilter } from './roadmap/board-utils'
```

Inside the component:

```tsx
  const view = useUiStore((s) => s.tabsBySection.roadmap) ?? 'list'
  const setTab = useUiStore((s) => s.setTab)
  const hideDone = useUiStore((s) => s.roadmapHideDone)
  const setHideDone = useUiStore((s) => s.setRoadmapHideDone)

  const items = list.data ?? []
  const visibleItems = hideDoneFilter(items, hideDone) // list uses this; board gets full items + hideDone flag
```

Header `action` gains the toggle + switch (reuse the existing `.tabs` styling for the List/Board switch, and a small button for hide-done). Keep the "new idea" button:

```tsx
        action={
          <div className="rm-head-actions">
            <div className="tabs rm-view-tabs">
              <button
                type="button"
                className={view === 'list' ? 'on' : ''}
                onClick={() => setTab('roadmap', 'list')}
              >
                List
              </button>
              <button
                type="button"
                className={view === 'board' ? 'on' : ''}
                onClick={() => setTab('roadmap', 'board')}
              >
                Board
              </button>
            </div>
            <button
              type="button"
              className={`btn${hideDone ? ' primary' : ''}`}
              onClick={() => setHideDone(!hideDone)}
              aria-pressed={hideDone}
            >
              {hideDone ? 'show done' : 'hide done'}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => useChatDrawer.getState().openSession({ type: 'roadmap' })}
            >
              <Plus size={12} /> new idea
            </button>
          </div>
        }
```

Body:

```tsx
      <div className="scroll">
        {list.isLoading ? (
          <div className="rm-empty">{'// loading…'}</div>
        ) : items.length === 0 ? (
          <div className="rm-empty">{'// no roadmap items yet — hit “new idea” to add one'}</div>
        ) : view === 'board' ? (
          <RoadmapBoard
            items={items}
            hideDone={hideDone}
            onCardClick={(item) => setEditing(item)}
            onStatusChange={(id, status) => update.mutate({ id, status })}
            onCopy={(text) => copyText.mutate({ text })}
          />
        ) : (
          <RoadmapList
            items={visibleItems}
            onEdit={(item) => setEditing(item)}
            onStatus={(id, status) => update.mutate({ id, status })}
            onDelete={(id) => remove.mutate({ id })}
            onCopy={(text) => copyText.mutate({ text })}
          />
        )}
      </div>
```

Keep the `<RoadmapDetail item={editing} … />` mount at the bottom.

- [ ] **Step 3: Add small header-actions CSS**

Append to `src/renderer/src/index.css`:

```css
.rm-head-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rm-view-tabs {
  margin: 0;
}
```

(The `.tabs` base styles already exist; `.rm-view-tabs` only removes any inherited margin.)

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Manually verify both views + drag + hide-done**

Run: `pnpm dev`. On ROADMAP:
- List/Board toggle switches views and **persists across reload** (reload the window; the last view stays).
- Board shows four columns with cards; drag a card to another column → its status changes and the card stays there (optimistic, no flicker); reload confirms it persisted.
- "hide done" toggles: List drops done rows; Board's Done column collapses to a count strip that still accepts a drop; choice persists across reload.
- Clicking a card opens the detail panel; the category filter narrows cards.
Stop the app.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/roadmap/RoadmapList.tsx src/renderer/src/pages/Roadmap.tsx src/renderer/src/index.css
git commit -m "feat(roadmap): List/Board toggle + hide-done, mount board

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: e2e board smoke test

**Files:**
- Modify: `e2e/app.spec.ts`

**Interfaces:**
- Consumes: existing e2e helpers/patterns in `app.spec.ts` (the Roadmap tests at lines ~51-75 show how to launch, navigate via the `02 ROADMAP` nav button, and assert).

- [ ] **Step 1: Add a board smoke test**

Add a test that opens ROADMAP, switches to the Board view, and asserts the four column headers plus at least one card are visible. Mirror the existing Roadmap tests' setup (reuse their app-launch/navigation boilerplate verbatim — do not invent a new harness):

```ts
test('Roadmap Board view shows status columns', async () => {
  // — reuse the same app launch + `await window.getByRole('button', { name: '02 ROADMAP' }).click()`
  //   setup as the existing "Roadmap page renders seeded items" test —
  await window.getByRole('button', { name: 'Board' }).click()

  await expect(window.getByText('To do', { exact: true })).toBeVisible()
  await expect(window.getByText('Planned', { exact: true })).toBeVisible()
  await expect(window.getByText('In progress', { exact: true })).toBeVisible()
  await expect(window.getByText('Done', { exact: true })).toBeVisible()
})
```

Adjust selectors to match the existing file's launch pattern and any column-header casing (the CSS uppercases headers via `text-transform`, so match on the DOM text `To do`/`Planned`/etc., not the rendered caps).

- [ ] **Step 2: Run the e2e suite**

Run: `pnpm test:e2e` (or the project's e2e script — confirm in `package.json`).
Expected: the new test and the existing Roadmap tests PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/app.spec.ts
git commit -m "test(roadmap): e2e smoke for board view

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] `pnpm vitest run` — all unit tests pass.
- [ ] `pnpm typecheck` — clean.
- [ ] `pnpm lint` — clean (aside from the pre-existing unrelated `any` warnings).
- [ ] `pnpm test:e2e` — passes.
- [ ] Manual: `pnpm dev` — List⇄Board toggle persists; drag changes status and persists; hide-done persists and behaves in both views; detail panel opens from both views and saves; existing "new idea" incubator chat still works.

## Self-Review Notes (against the spec)

- Spec §1 (rename + migration): Task 1 (rename) + Task 2 (migration) ✓
- Spec §2 (ui state): Task 3 ✓ (view toggle via existing `tabsBySection`, no new field; `roadmapHideDone` added)
- Spec §3 (page structure, KPI label, RoadmapList extraction): Tasks 1 + 7 ✓
- Spec §4 (board: columns, auto-sort, category badge+filter, cards, @dnd-kit optimistic, hide-done collapsed Done drop-strip): Tasks 4 + 5 + 7 ✓
- Spec §5 (unified detail panel replacing editor, placeholders, centered modal): Task 6 ✓
- Spec §6 (testing: enum, migration, pure helpers, e2e): Tasks 1, 2, 4, 8 ✓
- Data-flow / optimistic drag / migration idempotency / mergePersistedUi coercion: Tasks 2, 3, 7 ✓
