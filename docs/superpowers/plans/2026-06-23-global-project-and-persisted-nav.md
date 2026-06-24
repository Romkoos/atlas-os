# Global project selection + persisted nav — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project selection global across pages and persist the last-visited section + last-active tab per page across refresh and sessions, while removing the `days` range selector where it does nothing.

**Architecture:** Extend the existing `ui` zustand store with the `persist` middleware (localStorage) holding `section`, `selectedProject` (name-keyed, `null` = "first project" for Knowledge / "all projects" for Productivity), and `tabsBySection`. Pages read/write these instead of local `useState`. A pure `mergePersistedUi` function sanitizes rehydrated state (unit-tested in node). No backend/tRPC changes.

**Tech Stack:** React 19, zustand 5 (`persist` from `zustand/middleware`), tRPC + React Query, TypeScript, Vitest (node env), Playwright `_electron` for e2e, Biome for lint.

## Global Constraints

- Renderer source lives under `src/renderer/src`; aliases `@renderer`, `@shared`, `@main`.
- All UI strings stay English (project rule). No new user-facing copy needed here.
- Vitest runs in **node environment**, include glob `src/**/*.{test,spec}.ts` (only `.ts`, not `.tsx`). Unit tests must not depend on a DOM or `localStorage`.
- Lint/format via Biome (`pnpm lint`); types via `pnpm typecheck`. Both must pass before each commit.
- No backend, shared schema, drizzle, or tRPC router changes.
- Persist storage must be guarded so importing the store in a non-DOM (node/test) context does not throw.
- Commit messages end with the two trailers used in this repo:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01S5yMKDg2nheN9QG1XvgdzT
  ```

---

### Task 1: Extend the `ui` store with persistence + sanitizer

**Files:**
- Modify: `src/renderer/src/store/ui.ts` (currently 23 lines — full rewrite)
- Test: `src/renderer/src/store/ui.test.ts` (create)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type Section` — unchanged union (`'dashboard' | 'stats' | 'productivity' | 'knowledge' | 'news' | 'info' | 'skills' | 'plugins' | 'settings'`).
  - `const SECTIONS: readonly Section[]` — the section ids, for validation.
  - `useUiStore` zustand hook exposing state `{ section: Section; selectedProject: string | null; tabsBySection: Partial<Record<Section, string>> }` and actions `setSection(section: Section): void`, `setSelectedProject(project: string | null): void`, `setTab(section: Section, tab: string): void`.
  - `function mergePersistedUi(persisted: unknown, current: UiState): UiState` — pure sanitizer used by `persist`'s `merge`. Coerces a bad/partial persisted blob into valid state: unknown `section` → `'dashboard'`; missing `selectedProject` → `null`; missing/!object `tabsBySection` → `{}`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/store/ui.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mergePersistedUi, SECTIONS, useUiStore } from './ui'

const base = useUiStore.getState()

describe('mergePersistedUi', () => {
  it('keeps a valid persisted section', () => {
    const out = mergePersistedUi({ section: 'knowledge' }, base)
    expect(out.section).toBe('knowledge')
  })

  it('falls back to dashboard for an unknown section', () => {
    const out = mergePersistedUi({ section: 'bogus' }, base)
    expect(out.section).toBe('dashboard')
  })

  it('falls back to dashboard when section is missing', () => {
    const out = mergePersistedUi({}, base)
    expect(out.section).toBe('dashboard')
  })

  it('preserves selectedProject and tabsBySection when present', () => {
    const out = mergePersistedUi(
      { section: 'productivity', selectedProject: 'atlas-os', tabsBySection: { productivity: 'sessions' } },
      base,
    )
    expect(out.selectedProject).toBe('atlas-os')
    expect(out.tabsBySection).toEqual({ productivity: 'sessions' })
  })

  it('defaults selectedProject to null and tabsBySection to {} when absent or malformed', () => {
    const out = mergePersistedUi({ section: 'news', tabsBySection: 'nope' }, base)
    expect(out.selectedProject).toBeNull()
    expect(out.tabsBySection).toEqual({})
  })

  it('keeps action functions from current state (not from persisted blob)', () => {
    const out = mergePersistedUi({ section: 'stats', setSection: 'hacked' }, base)
    expect(typeof out.setSection).toBe('function')
  })

  it('SECTIONS contains the canonical pages', () => {
    expect(SECTIONS).toContain('dashboard')
    expect(SECTIONS).toContain('benchmark' as never) // sanity: benchmark is a tab, not a section
    expect(SECTIONS.includes('benchmark' as never)).toBe(false)
  })
})

describe('useUiStore actions', () => {
  it('setTab stores a per-section tab id', () => {
    useUiStore.getState().setTab('knowledge', 'graph')
    expect(useUiStore.getState().tabsBySection.knowledge).toBe('graph')
  })

  it('setSelectedProject updates the global project', () => {
    useUiStore.getState().setSelectedProject('mako3.0')
    expect(useUiStore.getState().selectedProject).toBe('mako3.0')
    useUiStore.getState().setSelectedProject(null)
    expect(useUiStore.getState().selectedProject).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/renderer/src/store/ui.test.ts`
Expected: FAIL — `mergePersistedUi` / `SECTIONS` not exported (import error).

- [ ] **Step 3: Rewrite the store**

Replace the entire contents of `src/renderer/src/store/ui.ts` with:

```ts
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Section =
  | 'dashboard'
  | 'stats'
  | 'productivity'
  | 'knowledge'
  | 'news'
  | 'info'
  | 'skills'
  | 'plugins'
  | 'settings'

export const SECTIONS: readonly Section[] = [
  'dashboard',
  'stats',
  'productivity',
  'knowledge',
  'news',
  'info',
  'skills',
  'plugins',
  'settings',
]

interface UiState {
  section: Section
  selectedProject: string | null
  tabsBySection: Partial<Record<Section, string>>
  setSection: (section: Section) => void
  setSelectedProject: (project: string | null) => void
  setTab: (section: Section, tab: string) => void
}

// Pure sanitizer for rehydrated state. A persisted blob can be partial, stale,
// or corrupt (renamed section across versions, hand-edited localStorage). Coerce
// it into valid state and always keep live action functions from `current`.
export function mergePersistedUi(persisted: unknown, current: UiState): UiState {
  const p = (persisted ?? {}) as Partial<UiState>
  const section =
    typeof p.section === 'string' && (SECTIONS as readonly string[]).includes(p.section)
      ? (p.section as Section)
      : 'dashboard'
  const selectedProject = typeof p.selectedProject === 'string' ? p.selectedProject : null
  const tabsBySection =
    p.tabsBySection && typeof p.tabsBySection === 'object' && !Array.isArray(p.tabsBySection)
      ? (p.tabsBySection as Partial<Record<Section, string>>)
      : {}
  return { ...current, section, selectedProject, tabsBySection }
}

// Guarded storage: returns the JSON storage only when a DOM localStorage exists,
// so importing this module under Vitest's node environment does not throw.
const guardedStorage = createJSONStorage<Pick<UiState, 'section' | 'selectedProject' | 'tabsBySection'>>(
  () => (typeof localStorage !== 'undefined' ? localStorage : (undefined as unknown as Storage)),
)

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      section: 'dashboard',
      selectedProject: null,
      tabsBySection: {},
      setSection: (section) => set({ section }),
      setSelectedProject: (selectedProject) => set({ selectedProject }),
      setTab: (section, tab) =>
        set((s) => ({ tabsBySection: { ...s.tabsBySection, [section]: tab } })),
    }),
    {
      name: 'atlas-ui',
      version: 1,
      storage: guardedStorage,
      partialize: (s) => ({
        section: s.section,
        selectedProject: s.selectedProject,
        tabsBySection: s.tabsBySection,
      }),
      merge: (persisted, current) => mergePersistedUi(persisted, current),
    },
  ),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/renderer/src/store/ui.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck:web && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/store/ui.ts src/renderer/src/store/ui.test.ts
git commit -m "feat(ui-store): persist section/project/tabs with sanitizing merge

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S5yMKDg2nheN9QG1XvgdzT"
```

---

### Task 2: Wire Knowledge to global project + persisted tab

**Files:**
- Modify: `src/renderer/src/pages/Knowledge.tsx` (lines ~38–43 state; ~52 `active`; ~64–72 dropdown; ~128–143 tabs)

**Interfaces:**
- Consumes from Task 1: `useUiStore` (`selectedProject`, `setSelectedProject`, `tabsBySection`, `setTab`).
- Produces: nothing downstream.

- [ ] **Step 1: Replace local state with store selectors**

In `src/renderer/src/pages/Knowledge.tsx`:

Add the store import near the other imports (after the existing `@renderer` imports):

```ts
import { useUiStore } from '@renderer/store/ui'
```

Remove these two lines inside `export function Knowledge()`:

```ts
  const [project, setProject] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('browse')
```

Replace them with store-backed values (place right after `const projects = trpc.knowledge.projects.useQuery()`):

```ts
  const selectedProject = useUiStore((s) => s.selectedProject)
  const setSelectedProject = useUiStore((s) => s.setSelectedProject)
  const storedTab = useUiStore((s) => s.tabsBySection.knowledge)
  const setTab = useUiStore((s) => s.setTab)
  const tab: Tab = TABS.some((t) => t.id === storedTab) ? (storedTab as Tab) : 'browse'
```

- [ ] **Step 2: Point `active` and the dropdown at the global project**

Change the `active` line from:

```ts
  const active = project ?? projects.data?.[0]?.name ?? null
```

to:

```ts
  const active = selectedProject ?? projects.data?.[0]?.name ?? null
```

Change the dropdown's handler from `onValueChange={setProject}` to:

```ts
                onValueChange={(v) => setSelectedProject(v)}
```

- [ ] **Step 3: Route tab clicks through the store**

Change the tab button handler in the `.tabs` block from `onClick={() => setTab(t.id)}` to:

```ts
                    onClick={() => setTab('knowledge', t.id)}
```

(The `tab === t.id` className and the `{tab === 'browse' && ...}` render switches below it are unchanged — `tab` is now the derived const.)

- [ ] **Step 4: Remove the now-unused `useState` import if orphaned**

`useState` is still used by `BrowseTab` (line ~157), so keep the import. Verify it is still imported.

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck:web && pnpm lint`
Expected: no errors (no unused `project`/`setProject`, `tab` typed as `Tab`).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Knowledge.tsx
git commit -m "feat(knowledge): use global project + persisted tab from ui store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S5yMKDg2nheN9QG1XvgdzT"
```

---

### Task 3: Wire Productivity to global project, persisted tab, conditional `days`

**Files:**
- Modify: `src/renderer/src/pages/Productivity.tsx` (state ~2249–2251; project dropdown ~2280–2288; `days` `.seg` ~2289–2300; tabs ~2309–2319)

**Interfaces:**
- Consumes from Task 1: `useUiStore` (`selectedProject`, `setSelectedProject`, `tabsBySection`, `setTab`).
- Consumes existing module constants in this file: `ALL_PROJECTS` (sentinel), `RANGES`, `TABS` (ids `overview | sessions | ecosystem | benchmark`), `type Tab`.
- Produces: nothing downstream.

- [ ] **Step 1: Add the store import**

Near the other `@renderer` imports at the top of `src/renderer/src/pages/Productivity.tsx`:

```ts
import { useUiStore } from '@renderer/store/ui'
```

- [ ] **Step 2: Replace local `tab` + derive `projectPath` from the global name**

Inside `export function Productivity()`, replace:

```ts
  const [tab, setTab] = useState<Tab>('overview')
  const [days, setDays] = useState(30)
  const [projectPath, setProjectPath] = useState<string | undefined>(undefined)
```

with:

```ts
  const [days, setDays] = useState(30)
  const selectedProject = useUiStore((s) => s.selectedProject)
  const setSelectedProject = useUiStore((s) => s.setSelectedProject)
  const storedTab = useUiStore((s) => s.tabsBySection.productivity)
  const setTab = useUiStore((s) => s.setTab)
  const tab: Tab = TABS.some((t) => t.id === storedTab) ? (storedTab as Tab) : 'overview'
```

(Keep `days` local — it is intentionally not persisted.)

Then, after `const projectList = projects.data ?? []` (line ~2265), derive the path from the global name:

```ts
  const matchedProject = projectList.find((p) => p.project === selectedProject)
  const projectPath = matchedProject?.projectPath
```

- [ ] **Step 3: Map the project dropdown to the global name**

Replace the project `TermSelect` block (the `value`/`onValueChange` lines ~2282–2283) with:

```ts
              value={projectPath ?? ALL_PROJECTS}
              onValueChange={(v) => {
                if (v === ALL_PROJECTS) {
                  setSelectedProject(null)
                  return
                }
                const picked = projectList.find((p) => p.projectPath === v)
                setSelectedProject(picked ? picked.project : null)
              }}
```

(The `options={[...]}` array below is unchanged.)

- [ ] **Step 4: Hide the `days` `.seg` selector on the Benchmark tab**

Wrap the `days` range `<div className="seg">…</div>` block (lines ~2289–2300) so it only renders for tabs that consume `days`:

```ts
            {tab !== 'benchmark' && (
              <div className="seg">
                {RANGES.map((r) => (
                  <button
                    key={r.days}
                    type="button"
                    className={days === r.days ? 'on' : ''}
                    onClick={() => setDays(r.days)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
```

- [ ] **Step 5: Route tab clicks through the store**

In the `.tabs` block (line ~2315) change `onClick={() => setTab(id)}` to:

```ts
              onClick={() => setTab('productivity', id)}
```

(The `{tab === 'overview' ? <OverviewTab days={days} projectPath={projectPath} /> : null}` switches below are unchanged.)

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm typecheck:web && pnpm lint`
Expected: no errors (no unused `setProjectPath`; `tab` typed `Tab`; `projectPath` is `string | undefined`).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/pages/Productivity.tsx
git commit -m "feat(productivity): global project, persisted tab, hide days on benchmark

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S5yMKDg2nheN9QG1XvgdzT"
```

---

### Task 4: Persist the News feed tab

**Files:**
- Modify: `src/renderer/src/pages/News.tsx` (state line 53; tab handler line 111)

**Interfaces:**
- Consumes from Task 1: `useUiStore` (`tabsBySection`, `setTab`).
- Consumes existing: `type FeedId`, `FEEDS` record (keys `ai-news | trending`).

- [ ] **Step 1: Add the store import**

After the existing `@renderer/store/...` imports in `src/renderer/src/pages/News.tsx`:

```ts
import { useUiStore } from '@renderer/store/ui'
```

- [ ] **Step 2: Replace local feed state with the persisted tab**

Replace:

```ts
  const [active, setActive] = useState<FeedId>('ai-news')
```

with:

```ts
  const storedFeed = useUiStore((s) => s.tabsBySection.news)
  const setTab = useUiStore((s) => s.setTab)
  const active: FeedId = storedFeed === 'trending' || storedFeed === 'ai-news' ? storedFeed : 'ai-news'
  const setActive = (id: FeedId) => setTab('news', id)
```

- [ ] **Step 3: Verify `useState` import**

`useState` is no longer used in `News.tsx` (only `useMemo` remains). Change the React import:

```ts
import { useMemo } from 'react'
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm typecheck:web && pnpm lint`
Expected: no errors (no unused `useState`; `setActive(id)` calls in the `.tabs` block still typecheck).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/News.tsx
git commit -m "feat(news): persist active feed tab via ui store

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S5yMKDg2nheN9QG1XvgdzT"
```

---

### Task 5: e2e — persistence across reload + benchmark hides `days`

**Files:**
- Modify: `src/main` is untouched; add tests to `e2e/app.spec.ts`

**Interfaces:**
- Consumes: the built app (`pnpm build` then `pnpm e2e`), Playwright `_electron`.
- Produces: nothing downstream.

- [ ] **Step 1: Add the e2e tests**

Append to `e2e/app.spec.ts`:

```ts
test('restores last section + tab after reload', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByText('ATLAS.OS')).toBeVisible()

  // Navigate to News and select the GitHub Trending feed tab.
  await window.getByRole('button', { name: '05 NEWS' }).click()
  await window.getByRole('button', { name: /GITHUB TRENDING/ }).click()
  await expect(window.getByRole('button', { name: /GITHUB TRENDING/ })).toHaveClass(/on/)

  // Reload the renderer; persisted ui store should reopen News on the trending tab.
  await window.reload()
  await expect(window.getByText('ATLAS.OS')).toBeVisible()
  await expect(window.getByRole('button', { name: /GITHUB TRENDING/ })).toHaveClass(/on/, {
    timeout: 15000,
  })

  await app.close()
})

test('Productivity benchmark tab hides the days range selector', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByText('ATLAS.OS')).toBeVisible()

  await window.getByRole('button', { name: '03 PRODUCTIVITY' }).click()

  // On overview, the 30d range button is present.
  await expect(window.getByRole('button', { name: '30d' })).toBeVisible({ timeout: 15000 })

  // Switch to benchmark: the days range buttons are removed.
  await window.getByRole('button', { name: './benchmark' }).click()
  await expect(window.getByRole('button', { name: '30d' })).toHaveCount(0)

  await app.close()
})
```

Note on the range labels: confirm the actual `RANGES` labels in `Productivity.tsx` (the analysis saw `1d / 7d / 30d`). If a label differs, use the real one in the selectors above. Confirm the benchmark tab button label in `TABS` (analysis saw `./benchmark`).

- [ ] **Step 2: Build the app**

Run: `pnpm build`
Expected: typecheck + electron-vite build succeed.

- [ ] **Step 3: Run the e2e suite**

Run: `pnpm e2e`
Expected: existing smoke tests still pass; the two new tests pass. (The reload test depends on localStorage surviving `window.reload()`, which it does for a `file://`/app origin in Electron.)

- [ ] **Step 4: Commit**

```bash
git add e2e/app.spec.ts
git commit -m "test(e2e): persist nav across reload + benchmark hides days selector

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01S5yMKDg2nheN9QG1XvgdzT"
```

---

## Self-Review

**Spec coverage:**
- Global project selection (name-keyed, `null` dual meaning) → Task 1 (state/actions) + Task 2 (Knowledge consumes `null` as first-project) + Task 3 (Productivity maps name↔path, `null` = all). ✓
- Persist last section → Task 1 (`persist` of `section`). ✓
- Persist last tab per page → Task 1 (`tabsBySection`) + Tasks 2/3/4 (Knowledge, Productivity, News write/read it). ✓
- Restore on load → Task 1 (`persist` + `merge`), verified in Task 5 reload test. ✓
- Validation guards (bad section/tab) → Task 1 `mergePersistedUi` (section) + per-page tab guards in Tasks 2/3/4. ✓
- Remove `days` where irrelevant (Benchmark) → Task 3 Step 4, verified in Task 5. ✓
- No backend changes → confirmed; only store + 3 pages + e2e touched. ✓
- News feed tabs persist → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The only conditional note (Task 5 label confirmation) instructs verifying against real constants, which is concrete.

**Type consistency:** `setTab(section, tab)` signature is used identically in Tasks 2/3/4. `selectedProject: string | null`, `setSelectedProject(project: string | null)`, and `tabsBySection: Partial<Record<Section, string>>` match across Task 1 definition and all consumers. `mergePersistedUi` / `SECTIONS` exported in Task 1 and imported in Task 1's test. Per-page tab guards cast a validated `string` to the page-local `Tab` union, which is sound because the candidate is checked against that page's `TABS`/`FEEDS` ids first.
