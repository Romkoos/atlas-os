# CHATS Page + Canvas — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all chats off the slide-out drawer/FAB onto a dedicated CHATS page — a vertical split with the conversation on the left and a per-type tabbed Canvas on the right, a draggable divider, and a live active-chat nav badge.

**Architecture:** A new `chats` section renders `ChatsPage`, which reuses the existing self-contained chat overlays in the left pane and a new `Canvas` component in the right pane. Chat sessions and their subscriptions already live above the page switch (App-level `ChatHost`s), so relocating the UI never stops a run. The `chatDrawer` UI store becomes a domain-agnostic `chats` store (tabs + layout). Phase 1 wires the page, split, badge, and the reuse-only Canvas views (Ideas / Results / Report); worker & general-chat Canvas data plumbing is Phase 2.

**Tech Stack:** React 18, TypeScript, Zustand (+ persist), tRPC, Vitest, Biome. Electron renderer.

## Global Constraints

- All UI strings and code identifiers in **English** (only generated digest content may be non-English).
- Verify main-process/UI changes in the running `pnpm dev` (hot-reload) before any packaging; do not run `pnpm dist` as part of this plan.
- Follow existing renderer patterns: Zustand stores under `src/renderer/src/store`, pages under `src/renderer/src/pages`, components under `src/renderer/src/components`. Global CSS lives in `src/renderer/src/index.css`.
- Custom Tailwind-collision-prone utilities (`mt-16` etc.) are unlayered — do not introduce new margin utilities that clash; use existing layout classes.
- Sessions/subscriptions are owned by App-level `ChatHost`s and must **not** be touched — do not add/remove subscriptions.
- Commit after every task (frequent commits). Work stays on branch `feat/chats-page-canvas`.

---

## File Structure

**Created:**
- `src/renderer/src/pages/Chats.tsx` — the CHATS page (tab strip, picker, split, left overlay host, right Canvas).
- `src/renderer/src/components/chat/SplitPane.tsx` — reusable draggable two-pane split.
- `src/renderer/src/components/chat/splitRatio.ts` — pure `clampSplitRatio` helper.
- `src/renderer/src/components/chat/splitRatio.test.ts` — its tests.
- `src/renderer/src/components/chat/Canvas.tsx` — the right-pane tabbed Canvas shell.
- `src/renderer/src/components/chat/canvasTabs.ts` — `tabsForType(type)` registry (pure).
- `src/renderer/src/components/chat/canvasTabs.test.ts` — its tests.
- `src/renderer/src/components/chat/canvas/IdeasCanvas.tsx` — roadmap saved-idea cards.
- `src/renderer/src/components/chat/canvas/ResultsCanvas.tsx` — benchmark batch results.
- `src/renderer/src/components/chat/canvas/ReportCanvas.tsx` — improver report.
- `src/renderer/src/components/chat/canvas/EmptyCanvas.tsx` — blank state.

**Modified:**
- `src/renderer/src/store/ui.ts` — add `'chats'` to `Section` + `SECTIONS`.
- `src/renderer/src/components/layout/nav.ts` — add `chats` NAV entry (position 3, after ROADMAP).
- `src/renderer/src/App.tsx` — register `chats` page; remove `<UnifiedChatDrawer/>` (Task 6).
- `src/renderer/src/store/chatDrawer.ts` → **rename** to `src/renderer/src/store/chats.ts`; export `useChats` + `goToChat`; drop `open`/`setOpen` (Task 6); add `splitRatio`, `canvasTabByType`.
- `src/renderer/src/store/chatDrawer.test.ts` → `chats.test.ts`; `chatDrawer.persist.test.ts` → `chats.persist.test.ts`.
- `src/renderer/src/store/roadmapChatRun.ts` — accumulate saved idea cards into a list.
- `src/renderer/src/components/layout/Sidebar.tsx` — active-chat badge on the `chats` item.
- `src/renderer/src/pages/{Roadmap,Skills,Dashboard,Productivity}.tsx` — swap `openSession(...)` for `goToChat(...)`.
- `src/renderer/src/index.css` — remove drawer/FAB CSS; add page/split/canvas CSS (Task 6).

**Deleted (Task 6):**
- `src/renderer/src/components/UnifiedChatDrawer.tsx`.

---

## Task 1: Section + nav item + placeholder page

**Files:**
- Modify: `src/renderer/src/store/ui.ts:4-29`
- Modify: `src/renderer/src/components/layout/nav.ts:11-23`
- Modify: `src/renderer/src/App.tsx:16-52`
- Create: `src/renderer/src/pages/Chats.tsx`
- Test: `src/renderer/src/store/ui.test.ts` (create if absent) OR extend nav test

**Interfaces:**
- Produces: `Section` union now includes `'chats'`; `NAV` contains `{ id: 'chats', key: '03', label: 'CHATS' }`; `PAGES.chats` renders `Chats`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/store/ui.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SECTIONS } from './ui'
import { NAV } from '@renderer/components/layout/nav'

describe('chats section', () => {
  it('is a known section', () => {
    expect(SECTIONS).toContain('chats')
  })
  it('has a nav item right after roadmap', () => {
    const ids = NAV.map((n) => n.id)
    expect(ids).toContain('chats')
    expect(ids.indexOf('chats')).toBe(ids.indexOf('roadmap') + 1)
  })
  it('keeps NAV keys as 1-based sequential [NN]', () => {
    NAV.forEach((n, i) => expect(n.key).toBe(String(i + 1).padStart(2, '0')))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/renderer/src/store/ui.test.ts`
Expected: FAIL — `SECTIONS` lacks `'chats'`.

- [ ] **Step 3: Add the section**

In `src/renderer/src/store/ui.ts`, add `| 'chats'` to the `Section` union (after `'roadmap'`) and `'chats'` to `SECTIONS` (after `'roadmap'`):

```ts
export type Section =
  | 'dashboard'
  | 'roadmap'
  | 'chats'
  | 'stats'
  | 'productivity'
  | 'knowledge'
  | 'news'
  | 'signals'
  | 'info'
  | 'skills'
  | 'plugins'
  | 'settings'

export const SECTIONS: readonly Section[] = [
  'dashboard',
  'roadmap',
  'chats',
  'stats',
  'productivity',
  'knowledge',
  'news',
  'signals',
  'info',
  'skills',
  'plugins',
  'settings',
]
```

- [ ] **Step 4: Add the nav item and renumber**

Replace the `NAV` array in `src/renderer/src/components/layout/nav.ts` (insert `chats` at index 2, renumber all `key`s so they stay sequential 1-based — this also shifts Cmd+N):

```ts
export const NAV: ReadonlyArray<NavItem> = [
  { id: 'dashboard', key: '01', label: 'DASHBOARD' },
  { id: 'roadmap', key: '02', label: 'ROADMAP' },
  { id: 'chats', key: '03', label: 'CHATS' },
  { id: 'stats', key: '04', label: 'STATS' },
  { id: 'productivity', key: '05', label: 'PRODUCTIVITY' },
  { id: 'knowledge', key: '06', label: 'KNOWLEDGE' },
  { id: 'news', key: '07', label: 'NEWS' },
  { id: 'signals', key: '08', label: 'SIGNALS' },
  { id: 'info', key: '09', label: 'INFO' },
  { id: 'skills', key: '10', label: 'SKILLS' },
  { id: 'plugins', key: '11', label: 'PLUGINS' },
  { id: 'settings', key: '12', label: 'SETTINGS' },
]
```

- [ ] **Step 5: Create the placeholder page**

Create `src/renderer/src/pages/Chats.tsx`:

```tsx
// The CHATS page. Phase 1 assembles the tab strip, split, and Canvas; this
// placeholder is replaced in Task 6's cutover.
export function Chats() {
  return (
    <div className="page">
      <h2>CHATS</h2>
    </div>
  )
}
```

- [ ] **Step 6: Register the page**

In `src/renderer/src/App.tsx`: add the import `import { Chats } from '@renderer/pages/Chats'` (alphabetical with the other page imports) and add `chats: Chats,` to the `PAGES` map (after `roadmap: Roadmap,`).

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm vitest run src/renderer/src/store/ui.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean (the `Section` union change compiles because `PAGES` is `Record<Section, ComponentType>` and now has `chats`).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/store/ui.ts src/renderer/src/store/ui.test.ts \
  src/renderer/src/components/layout/nav.ts src/renderer/src/App.tsx \
  src/renderer/src/pages/Chats.tsx
git commit -m "feat(chats): add CHATS section, nav item, placeholder page"
```

---

## Task 2: `chats` store — additive layout state + `goToChat` + saved-idea list

Additive only. `open`/`setOpen` and the drawer stay working; they are removed in Task 6's cutover.

**Files:**
- Rename: `src/renderer/src/store/chatDrawer.ts` → `src/renderer/src/store/chats.ts`
- Rename: `src/renderer/src/store/chatDrawer.test.ts` → `src/renderer/src/store/chats.test.ts`
- Rename: `src/renderer/src/store/chatDrawer.persist.test.ts` → `src/renderer/src/store/chats.persist.test.ts`
- Modify: `src/renderer/src/store/roadmapChatRun.ts` (saved list)
- Modify importers: `src/renderer/src/components/UnifiedChatDrawer.tsx`, `src/renderer/src/pages/{Roadmap,Skills,Dashboard,Productivity}.tsx`
- Test: `src/renderer/src/store/chats.test.ts`

**Interfaces:**
- Produces:
  - `useChats` (Zustand): existing `sessions`, `activeSessionId`, `openSession`, `closeSession`, `setActive`, `open`, `setOpen` (unchanged) **plus** `splitRatio: number`, `setSplitRatio(r: number): void`, `canvasTabByType: Partial<Record<ChatSessionType, string>>`, `setCanvasTab(type: ChatSessionType, tab: string): void`.
  - `goToChat(input: { type: ChatSessionType; title?: string }): void` — opens the session and navigates to the `chats` section.
  - `ChatSessionType`, `ChatSession`, `mergePersistedChats` (renamed from `mergePersistedChatDrawer`).
  - `useRoadmapSaved`: existing `savedItem`/`setSaved`/`clearSaved` **plus** `savedItems: RoadmapItem[]` (accumulated).

- [ ] **Step 1: Rename the store files (preserve git history)**

```bash
git mv src/renderer/src/store/chatDrawer.ts src/renderer/src/store/chats.ts
git mv src/renderer/src/store/chatDrawer.test.ts src/renderer/src/store/chats.test.ts
git mv src/renderer/src/store/chatDrawer.persist.test.ts src/renderer/src/store/chats.persist.test.ts
```

- [ ] **Step 2: Write the failing tests for the new state**

Append to `src/renderer/src/store/chats.test.ts`:

```ts
import { act } from 'react'
import { useChats } from './chats'

describe('chats layout state', () => {
  it('defaults splitRatio to 0.5', () => {
    expect(useChats.getState().splitRatio).toBe(0.5)
  })
  it('clamps splitRatio into [0.2, 0.8]', () => {
    act(() => useChats.getState().setSplitRatio(0.95))
    expect(useChats.getState().splitRatio).toBe(0.8)
    act(() => useChats.getState().setSplitRatio(0.05))
    expect(useChats.getState().splitRatio).toBe(0.2)
  })
  it('remembers the canvas tab per type', () => {
    act(() => useChats.getState().setCanvasTab('worker', 'Docs'))
    expect(useChats.getState().canvasTabByType.worker).toBe('Docs')
  })
})
```

Also update every existing `import ... from './chatDrawer'` / `useChatDrawer` reference in the two test files to `./chats` / `useChats`, and rename `mergePersistedChatDrawer` → `mergePersistedChats`.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm vitest run src/renderer/src/store/chats.test.ts`
Expected: FAIL — `useChats` undefined / `splitRatio` missing.

- [ ] **Step 4: Implement the store changes**

In `src/renderer/src/store/chats.ts`:
1. Rename the exported hook `useChatDrawer` → `useChats` and `mergePersistedChatDrawer` → `mergePersistedChats`.
2. Add to `ChatDrawerState` (rename the interface to `ChatsState`):

```ts
  splitRatio: number
  setSplitRatio: (r: number) => void
  canvasTabByType: Partial<Record<ChatSessionType, string>>
  setCanvasTab: (type: ChatSessionType, tab: string) => void
```

3. Add the ratio clamp constant and use it (min 20% / max 80% of the container as a coarse ratio guard; pixel min-width is enforced separately in `SplitPane`):

```ts
export const MIN_SPLIT = 0.2
export const MAX_SPLIT = 0.8
const clampRatio = (r: number) => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, r))
```

4. In the `create(...)` initializer add:

```ts
      splitRatio: 0.5,
      setSplitRatio: (r) => set({ splitRatio: clampRatio(r) }),
      canvasTabByType: {},
      setCanvasTab: (type, tab) =>
        set((s) => ({ canvasTabByType: { ...s.canvasTabByType, [type]: tab } })),
```

5. In the persist config: bump `version: 2` → `version: 3`, extend `partialize` to include `splitRatio` and `canvasTabByType`, and in `mergePersistedChats` carry them through with clamping/validation:

```ts
  const splitRatio =
    typeof p.splitRatio === 'number' && Number.isFinite(p.splitRatio)
      ? clampRatio(p.splitRatio)
      : 0.5
  const canvasTabByType =
    p.canvasTabByType && typeof p.canvasTabByType === 'object' && !Array.isArray(p.canvasTabByType)
      ? (p.canvasTabByType as Partial<Record<ChatSessionType, string>>)
      : {}
  return { ...current, open: ..., sessions, activeSessionId, splitRatio, canvasTabByType }
```

6. Add the navigation helper at the bottom of the file:

```ts
import { useUiStore } from '@renderer/store/ui'

// Open (or focus) a chat and bring the CHATS page forward. External callers
// (Roadmap/Skills/Dashboard/Productivity) use this instead of openSession so a
// button press both starts the chat and navigates to it.
export function goToChat(input: { type: ChatSessionType; title?: string }): void {
  useChats.getState().openSession(input)
  useUiStore.getState().setSection('chats')
}
```

- [ ] **Step 5: Add the saved-idea list to roadmap run store**

In `src/renderer/src/store/roadmapChatRun.ts` extend `RoadmapSavedState`:

```ts
  savedItems: RoadmapItem[]
```

Initialize `savedItems: []`; in `setSaved` also append (dedupe by `id`, newest first):

```ts
  setSaved: (savedItem) =>
    set((s) => ({
      savedItem,
      savedItems: [savedItem, ...s.savedItems.filter((x) => x.id !== savedItem.id)],
    })),
  clearSaved: () => set({ savedItem: null, savedItems: [] }),
```

- [ ] **Step 6: Update non-test importers to the new names**

- `UnifiedChatDrawer.tsx`: change import to `import { type ChatSessionType, useChats } from '@renderer/store/chats'` and replace `useChatDrawer` with `useChats` throughout (drawer keeps working — `open`/`setOpen` still exist).
- `pages/Roadmap.tsx` (lines ~69, ~81, ~126), `pages/Skills.tsx` (~97), `pages/Dashboard.tsx` (~307), `pages/Productivity.tsx` (~2121): replace `useChatDrawer.getState().openSession({ ... })` with `goToChat({ ... })` and import `goToChat` from `@renderer/store/chats`. Remove now-unused `useChatDrawer` imports.

- [ ] **Step 7: Run tests + typecheck**

Run: `pnpm vitest run src/renderer/src/store && pnpm typecheck`
Expected: PASS (existing store tests still green under new names; new layout tests pass).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/store src/renderer/src/components/UnifiedChatDrawer.tsx \
  src/renderer/src/pages/Roadmap.tsx src/renderer/src/pages/Skills.tsx \
  src/renderer/src/pages/Dashboard.tsx src/renderer/src/pages/Productivity.tsx
git commit -m "feat(chats): rename drawer store to chats + add split/canvas layout state + goToChat"
```

---

## Task 3: Active-chat nav badge

**Files:**
- Modify: `src/renderer/src/components/layout/Sidebar.tsx:29-78`

**Interfaces:**
- Consumes: `useChats().sessions` (count).

- [ ] **Step 1: Read the count in Sidebar**

In `Sidebar.tsx`, add near the other store reads:

```ts
import { useChats } from '@renderer/store/chats'
// ...
  const activeChats = useChats((s) => s.sessions.length)
```

- [ ] **Step 2: Render the badge on the chats item**

In the `NAV.map(...)` render, extend the badge branch so `chats` shows its count (mirrors the existing `signals` branch):

```tsx
            {n.id === 'signals' && unreadSignals > 0 ? (
              <span className="nav-badge">{unreadSignals > 99 ? '99+' : unreadSignals}</span>
            ) : n.id === 'chats' && activeChats > 0 ? (
              <span className="nav-badge">{activeChats}</span>
            ) : (
              <span className="badge" />
            )}
```

- [ ] **Step 3: Verify in dev**

Run: `pnpm dev` (if not running). Open a chat via any entry point → the CHATS nav item shows a count badge; close all chats → badge disappears.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/Sidebar.tsx
git commit -m "feat(chats): active-chat count badge on the CHATS nav item"
```

---

## Task 4: `clampSplitRatio` helper + `SplitPane` component

**Files:**
- Create: `src/renderer/src/components/chat/splitRatio.ts`
- Create: `src/renderer/src/components/chat/splitRatio.test.ts`
- Create: `src/renderer/src/components/chat/SplitPane.tsx`

**Interfaces:**
- Produces:
  - `clampSplitRatio(ratio: number, containerPx: number, minPx: number): number` — clamps so neither pane is below `minPx`; returns `0.5` if `containerPx < 2*minPx`.
  - `SplitPane` React component: props `{ ratio: number; onRatioChange: (r: number) => void; minPx?: number; left: React.ReactNode; right: React.ReactNode }`.

- [ ] **Step 1: Write the failing helper test**

Create `src/renderer/src/components/chat/splitRatio.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clampSplitRatio } from './splitRatio'

describe('clampSplitRatio', () => {
  it('passes through a mid ratio', () => {
    expect(clampSplitRatio(0.5, 1000, 360)).toBe(0.5)
  })
  it('clamps so the left pane keeps its minimum', () => {
    // minPx/container = 0.36 → 0.1 is too small
    expect(clampSplitRatio(0.1, 1000, 360)).toBeCloseTo(0.36, 5)
  })
  it('clamps so the right pane keeps its minimum', () => {
    expect(clampSplitRatio(0.95, 1000, 360)).toBeCloseTo(0.64, 5)
  })
  it('centres when the container is too narrow for two minimums', () => {
    expect(clampSplitRatio(0.9, 600, 360)).toBe(0.5)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/renderer/src/components/chat/splitRatio.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/renderer/src/components/chat/splitRatio.ts`:

```ts
// Clamp a left/right split ratio so neither pane falls below `minPx`. When the
// container cannot hold two minimums, fall back to a centred 0.5.
export function clampSplitRatio(ratio: number, containerPx: number, minPx: number): number {
  if (!Number.isFinite(ratio) || containerPx <= 0) return 0.5
  if (containerPx < minPx * 2) return 0.5
  const min = minPx / containerPx
  const max = 1 - min
  return Math.min(max, Math.max(min, ratio))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/renderer/src/components/chat/splitRatio.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement SplitPane**

Create `src/renderer/src/components/chat/SplitPane.tsx`:

```tsx
import { useCallback, useEffect, useRef } from 'react'
import { clampSplitRatio } from './splitRatio'

interface SplitPaneProps {
  ratio: number
  onRatioChange: (r: number) => void
  left: React.ReactNode
  right: React.ReactNode
  minPx?: number
}

// Two horizontal panes with a draggable vertical gutter. The ratio is the left
// pane's fraction of the container width; the parent owns/persists it. Both
// panes keep a pixel minimum (clampSplitRatio). Keyboard: arrows nudge ±2%.
export function SplitPane({ ratio, onRatioChange, left, right, minPx = 360 }: SplitPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const applyFromClientX = useCallback(
    (clientX: number) => {
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const raw = (clientX - rect.left) / rect.width
      onRatioChange(clampSplitRatio(raw, rect.width, minPx))
    },
    [onRatioChange, minPx],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      e.preventDefault()
      applyFromClientX(e.clientX)
    }
    const onUp = () => {
      draggingRef.current = false
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [applyFromClientX])

  // Re-clamp on container resize so a persisted ratio never violates min widths.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      onRatioChange(clampSplitRatio(ratio, el.getBoundingClientRect().width, minPx))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ratio, onRatioChange, minPx])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onRatioChange(ratio - 0.02)
    else if (e.key === 'ArrowRight') onRatioChange(ratio + 0.02)
  }

  return (
    <div className="split-pane" ref={rootRef}>
      <div className="split-left" style={{ flexBasis: `${ratio * 100}%` }}>
        {left}
      </div>
      <div
        className="split-gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        tabIndex={0}
        onPointerDown={(e) => {
          draggingRef.current = true
          document.body.style.userSelect = 'none'
          applyFromClientX(e.clientX)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="split-right">{right}</div>
    </div>
  )
}
```

> Note: `onRatioChange` is `useChats.setSplitRatio`, which already applies the coarse `[0.2,0.8]` guard; `clampSplitRatio` adds the exact pixel-min guard on top. Passing an unclamped value is safe.

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/chat/splitRatio.ts \
  src/renderer/src/components/chat/splitRatio.test.ts \
  src/renderer/src/components/chat/SplitPane.tsx
git commit -m "feat(chats): draggable SplitPane + clampSplitRatio helper"
```

---

## Task 5: Canvas shell + `tabsForType` + reuse views + empty state

Builds the Canvas in isolation (not yet mounted — Task 6 mounts it). Phase 1 covers Ideas / Results / Report; worker and general-chat return no tabs (empty pane) until Phase 2.

**Files:**
- Create: `src/renderer/src/components/chat/canvasTabs.ts`
- Create: `src/renderer/src/components/chat/canvasTabs.test.ts`
- Create: `src/renderer/src/components/chat/Canvas.tsx`
- Create: `src/renderer/src/components/chat/canvas/IdeasCanvas.tsx`
- Create: `src/renderer/src/components/chat/canvas/ResultsCanvas.tsx`
- Create: `src/renderer/src/components/chat/canvas/ReportCanvas.tsx`
- Create: `src/renderer/src/components/chat/canvas/EmptyCanvas.tsx`
- Test: `src/renderer/src/components/chat/canvasTabs.test.ts`

**Interfaces:**
- Consumes: `ChatSessionType` from `@renderer/store/chats`; `useRoadmapSaved` (`savedItems`), `useBenchmarkChatContext` (`batchId`) + `trpc.benchmark.*`, `useSkillImproverExtra` (`report`).
- Produces:
  - `interface CanvasTab { key: string; label: string; View: React.ComponentType }`
  - `tabsForType(type: ChatSessionType): CanvasTab[]` — Phase 1 returns `[Ideas]` for `roadmap`, `[Results]` for `benchmark`, `[Report]` for `skillImprover`, and `[]` for `worker` / `generalChat`.
  - `Canvas` component: props `{ type: ChatSessionType }`.

- [ ] **Step 1: Write the failing tabs test**

Create `src/renderer/src/components/chat/canvasTabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { tabsForType } from './canvasTabs'

describe('tabsForType', () => {
  it('gives roadmap an Ideas tab', () => {
    expect(tabsForType('roadmap').map((t) => t.label)).toEqual(['Ideas'])
  })
  it('gives benchmark a Results tab', () => {
    expect(tabsForType('benchmark').map((t) => t.label)).toEqual(['Results'])
  })
  it('gives skillImprover a Report tab', () => {
    expect(tabsForType('skillImprover').map((t) => t.label)).toEqual(['Report'])
  })
  it('gives worker and generalChat no tabs in phase 1', () => {
    expect(tabsForType('worker')).toEqual([])
    expect(tabsForType('generalChat')).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/renderer/src/components/chat/canvasTabs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reuse views**

Create `src/renderer/src/components/chat/canvas/IdeasCanvas.tsx`:

```tsx
import { useRoadmapSaved } from '@renderer/store/roadmapChatRun'

// Ideas the incubator committed this session, newest first. Empty until the
// chat saves its first card.
export function IdeasCanvas() {
  const items = useRoadmapSaved((s) => s.savedItems)
  if (items.length === 0) {
    return <div className="canvas-empty">No ideas saved yet — they'll appear here.</div>
  }
  return (
    <div className="canvas-list">
      {items.map((it) => (
        <div key={it.id} className="idea-card">
          <div className="idea-title">{it.title}</div>
          {it.description ? <div className="idea-desc">{it.description}</div> : null}
          <div className="idea-status">{it.status}</div>
        </div>
      ))}
    </div>
  )
}
```

Create `src/renderer/src/components/chat/canvas/ResultsCanvas.tsx`:

```tsx
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatContext } from '@renderer/store/benchmarkChatRun'
import { skipToken } from '@tanstack/react-query'

// The batch this discussion is about. Reads batchId from the companion store and
// fetches the run summary via the existing benchmark router.
export function ResultsCanvas() {
  const batchId = useBenchmarkChatContext((s) => s.batchId)
  const batch = trpc.benchmark.getBatch.useQuery(batchId ? { batchId } : skipToken)
  if (!batchId) return <div className="canvas-empty">No batch attached.</div>
  if (batch.isLoading) return <div className="canvas-empty">Loading results…</div>
  const runs = batch.data?.runs ?? []
  return (
    <div className="canvas-list">
      <div className="canvas-h">batch · {runs.length} runs</div>
      <table className="canvas-table">
        <thead>
          <tr><th>run</th><th>tokens</th><th>wall</th></tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td>{r.label ?? r.id}</td>
              <td>{r.totalTokens?.toLocaleString() ?? '—'}</td>
              <td>{r.wallMs ? `${Math.round(r.wallMs / 1000)}s` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

> Implementer note: confirm the exact `trpc.benchmark.getBatch` procedure name and its run field names against `src/main/trpc/routers` and `benchmarkChatRun.ts`. If the procedure/shape differs, adapt the field access; the Canvas only needs a run list with an id, a token count, and a duration. Keep the component tolerant of missing fields (`?? '—'`).

Create `src/renderer/src/components/chat/canvas/ReportCanvas.tsx`:

```tsx
import { useSkillImproverExtra } from '@renderer/store/skillImproverRun'

// The improver's A/B report for the target skill, once produced.
export function ReportCanvas() {
  const report = useSkillImproverExtra((s) => s.report)
  if (!report) return <div className="canvas-empty">No report yet.</div>
  return (
    <div className="canvas-list">
      <div className="canvas-h">{report.skillName ?? 'skill'} · report</div>
      <pre className="canvas-report">{JSON.stringify(report, null, 2)}</pre>
    </div>
  )
}
```

> Implementer note: `ImproverReport` shape is in `@shared/skillImprover`. Render its real fields (verdict, proposed edits) instead of the raw JSON dump if the shape is small and stable; the JSON fallback guarantees a working first cut.

Create `src/renderer/src/components/chat/canvas/EmptyCanvas.tsx`:

```tsx
// Blank right pane for chat types with no Canvas content (worker & general chat
// in Phase 1, or any type before it produces output). Intentionally minimal — a
// bare chat's right pane stays empty; drag the divider to reclaim the width.
export function EmptyCanvas() {
  return <div className="canvas-empty" aria-hidden="true" />
}
```

- [ ] **Step 4: Implement `tabsForType`**

Create `src/renderer/src/components/chat/canvasTabs.ts`:

```ts
import type { ChatSessionType } from '@renderer/store/chats'
import type { ComponentType } from 'react'
import { IdeasCanvas } from './canvas/IdeasCanvas'
import { ReportCanvas } from './canvas/ReportCanvas'
import { ResultsCanvas } from './canvas/ResultsCanvas'

export interface CanvasTab {
  key: string
  label: string
  View: ComponentType
}

// The Canvas tab set for a chat type. Phase 1: reuse-only views. worker &
// generalChat get their tabs (Changes/Docs/Artifact, Artifact/Context) in Phase 2.
export function tabsForType(type: ChatSessionType): CanvasTab[] {
  switch (type) {
    case 'roadmap':
      return [{ key: 'ideas', label: 'Ideas', View: IdeasCanvas }]
    case 'benchmark':
      return [{ key: 'results', label: 'Results', View: ResultsCanvas }]
    case 'skillImprover':
      return [{ key: 'report', label: 'Report', View: ReportCanvas }]
    default:
      return []
  }
}
```

- [ ] **Step 5: Implement the Canvas shell**

Create `src/renderer/src/components/chat/Canvas.tsx`:

```tsx
import { type ChatSessionType, useChats } from '@renderer/store/chats'
import { useMemo } from 'react'
import { EmptyCanvas } from './canvas/EmptyCanvas'
import { tabsForType } from './canvasTabs'

// Right-pane surface for the active chat. One tab strip; the tab set comes from
// the chat type. The selected tab is remembered per type in the chats store.
export function Canvas({ type }: { type: ChatSessionType }) {
  const tabs = useMemo(() => tabsForType(type), [type])
  const remembered = useChats((s) => s.canvasTabByType[type])
  const setCanvasTab = useChats((s) => s.setCanvasTab)

  if (tabs.length === 0) return <EmptyCanvas />

  const activeKey = tabs.some((t) => t.key === remembered) ? remembered : tabs[0].key
  const active = tabs.find((t) => t.key === activeKey) ?? tabs[0]
  const View = active.View

  return (
    <div className="canvas">
      <div className="canvas-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === active.key}
            className={`canvas-tab${t.key === active.key ? ' on' : ''}`}
            onClick={() => setCanvasTab(type, t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="canvas-body">
        <View />
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run src/renderer/src/components/chat/canvasTabs.test.ts && pnpm typecheck`
Expected: tabs test PASS; typecheck clean (fix field-name mismatches flagged in the notes if the compiler complains about `getBatch`/`report` shapes).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/chat/canvasTabs.ts \
  src/renderer/src/components/chat/canvasTabs.test.ts \
  src/renderer/src/components/chat/Canvas.tsx \
  src/renderer/src/components/chat/canvas
git commit -m "feat(chats): Canvas shell + tabsForType + Ideas/Results/Report views"
```

---

## Task 6: Cutover — assemble `ChatsPage`, delete drawer/FAB, swap CSS

Atomic swap so the chat overlays are only ever mounted once (the drawer mounts overlay bodies even when collapsed). After this task the drawer is gone.

**Files:**
- Rewrite: `src/renderer/src/pages/Chats.tsx`
- Modify: `src/renderer/src/App.tsx` (remove drawer import + mount)
- Modify: `src/renderer/src/store/chats.ts` (drop `open`/`setOpen`)
- Modify: `src/renderer/src/store/chats.test.ts` (drop `open` assertions)
- Delete: `src/renderer/src/components/UnifiedChatDrawer.tsx`
- Modify: `src/renderer/src/index.css` (remove drawer/FAB CSS; add page/split/canvas CSS)

**Interfaces:**
- Consumes: `useChats`, the five overlays, `Canvas`, `SplitPane`, the cancel mutations + run-store `reset()`/`clearX()` (the `endSession` logic lifted verbatim from the drawer).

- [ ] **Step 1: Build the CHATS page**

Rewrite `src/renderer/src/pages/Chats.tsx`. Lift the tab strip, the Chat-vs-Worker picker, and the `endSession` logic **verbatim** from `UnifiedChatDrawer.tsx` (imports, the five cancel mutations, `endSession`, `openChat`, `pickerButtons`), then render into the split:

```tsx
import { BenchmarkChatOverlay } from '@renderer/components/BenchmarkChatOverlay'
import { Canvas } from '@renderer/components/chat/Canvas'
import { SplitPane } from '@renderer/components/chat/SplitPane'
import { GeneralChatOverlay } from '@renderer/components/GeneralChatOverlay'
import { RoadmapChatOverlay } from '@renderer/components/RoadmapChatOverlay'
import { SkillImproverOverlay } from '@renderer/components/SkillImproverOverlay'
import { WorkerChatOverlay } from '@renderer/components/WorkerChatOverlay'
import { springSnappy } from '@renderer/lib/motion'
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatContext, useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { type ChatSessionType, useChats } from '@renderer/store/chats'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useRoadmapChatRun, useRoadmapSaved } from '@renderer/store/roadmapChatRun'
import { useSkillImproverExtra, useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import { MessageSquare, Plus, Wrench, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'

export function Chats() {
  const sessions = useChats((s) => s.sessions)
  const activeSessionId = useChats((s) => s.activeSessionId)
  const setActive = useChats((s) => s.setActive)
  const openSession = useChats((s) => s.openSession)
  const closeSession = useChats((s) => s.closeSession)
  const splitRatio = useChats((s) => s.splitRatio)
  const setSplitRatio = useChats((s) => s.setSplitRatio)

  const benchCancel = trpc.benchmarkChat.cancel.useMutation()
  const roadmapCancel = trpc.roadmapChat.cancel.useMutation()
  const skillCancel = trpc.skillImprover.cancel.useMutation()
  const generalCancel = trpc.generalChat.cancel.useMutation()
  const workerCancel = trpc.workerChat.cancel.useMutation()
  const [pickerOpen, setPickerOpen] = useState(false)

  // endSession(type): lifted verbatim from UnifiedChatDrawer (cancel running run,
  // reset the run store, clear the companion store, closeSession).
  const endSession = (type: ChatSessionType) => {
    /* ...verbatim from UnifiedChatDrawer.tsx lines 38-64... */
    closeSession(type)
  }

  // openChat(type): lifted verbatim from UnifiedChatDrawer (reset unless mid-stream,
  // then openSession + close picker).
  const openChat = (type: 'generalChat' | 'worker') => {
    /* ...verbatim from UnifiedChatDrawer.tsx lines 70-80... */
    openSession({ type })
    setPickerOpen(false)
  }

  const active = sessions.find((s) => s.id === activeSessionId)

  const pickerButtons = (
    <>
      <button type="button" className="chat-picker-btn" onClick={() => openChat('generalChat')}>
        <MessageSquare size={16} />
        <span>Chat</span>
      </button>
      <button type="button" className="chat-picker-btn" onClick={() => openChat('worker')}>
        <Wrench size={16} />
        <span>Worker</span>
      </button>
    </>
  )

  const overlay = (
    <>
      {active?.type === 'benchmark' ? <BenchmarkChatOverlay /> : null}
      {active?.type === 'roadmap' ? <RoadmapChatOverlay /> : null}
      {active?.type === 'skillImprover' ? <SkillImproverOverlay /> : null}
      {active?.type === 'generalChat' ? <GeneralChatOverlay /> : null}
      {active?.type === 'worker' ? <WorkerChatOverlay /> : null}
    </>
  )

  return (
    <div className="chats-page">
      <div className="chats-tabs">
        <div className="chats-tablist">
          {sessions.map((s) => (
            <div key={s.id} className={`chat-tab${s.id === activeSessionId ? ' active' : ''}`}>
              {s.id === activeSessionId && (
                <motion.span layoutId="chats-tab" className="tab-ink" transition={springSnappy} />
              )}
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
          <div className="chat-new-wrap">
            <button
              type="button"
              className="chat-drawer-new"
              aria-label="New chat"
              onClick={() => setPickerOpen((o) => !o)}
            >
              <Plus size={14} />
            </button>
            {pickerOpen ? (
              <div className="chat-picker chat-picker-inline" role="menu">
                {pickerButtons}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {active ? (
        <SplitPane
          ratio={splitRatio}
          onRatioChange={setSplitRatio}
          left={<div className="chat-left">{overlay}</div>}
          right={<Canvas type={active.type} />}
        />
      ) : (
        <div className="chats-empty">No chats open. Use + to start one.</div>
      )}
    </div>
  )
}
```

Fill the two `/* verbatim */` blocks by copying the corresponding bodies from `UnifiedChatDrawer.tsx` before deleting it (Step 4).

- [ ] **Step 2: Remove the drawer from App**

In `src/renderer/src/App.tsx`: delete the `import { UnifiedChatDrawer }` line and the `<UnifiedChatDrawer />` element (line ~151). Leave all `<ChatHost … />` mounts untouched.

- [ ] **Step 3: Drop `open`/`setOpen` from the store**

In `src/renderer/src/store/chats.ts`: remove `open` and `setOpen` from `ChatsState`, the initializer, `partialize`, and set `open`-free return in `mergePersistedChats` (drop the `open:` field). In `openSession`/`closeSession` reducers remove the `open` writes. Bump persist `version` 3 → 4. In `chats.test.ts` remove assertions that reference `open`/`setOpen`.

- [ ] **Step 4: Delete the drawer component**

```bash
git rm src/renderer/src/components/UnifiedChatDrawer.tsx
```

- [ ] **Step 5: Swap the CSS**

In `src/renderer/src/index.css`: remove the drawer/FAB rule blocks (`.chat-fab`, `.chat-fab-badge`, `.chat-fab-hidden`, `.chat-drawer`, `.chat-drawer-tabs`, `.chat-drawer-tablist`, `.chat-drawer-body`, `.chat-drawer-new`, `.chat-drawer-collapse`, `.chat-picker` positioning that assumed a floating layer — keep `.chat-picker-inline`, `.chat-picker-btn`, `.chat-tab*`, `.tab-ink` which the page reuses). Add page/split/canvas rules:

```css
.chats-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.chats-tabs { border-bottom: 1px solid var(--line); }
.chats-tablist { display: flex; gap: 2px; padding: 6px 8px 0; align-items: flex-end; }
.chats-empty,
.canvas-empty { display: grid; place-items: center; height: 100%; color: var(--ink-faint);
  font-family: var(--mono); font-size: 12px; }

.split-pane { display: flex; flex: 1; min-height: 0; }
.split-left { min-width: 360px; overflow: hidden; display: flex; flex-direction: column; }
.split-right { flex: 1; min-width: 360px; overflow: hidden; display: flex; flex-direction: column; }
.split-gutter { flex: 0 0 6px; cursor: col-resize; background: var(--line);
  transition: background .15s; }
.split-gutter:hover,
.split-gutter:focus-visible { background: var(--amber); outline: none; }

.chat-left { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.canvas { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.canvas-tabs { display: flex; gap: 2px; padding: 6px 8px 0; border-bottom: 1px solid var(--line); }
.canvas-tab { font-family: var(--mono); font-size: 11px; padding: 6px 11px; color: var(--ink-dim);
  background: none; border: 1px solid transparent; border-bottom: none; border-radius: 7px 7px 0 0; }
.canvas-tab.on { color: var(--amber); background: var(--panel-2); border-color: var(--line); }
.canvas-body { flex: 1; min-height: 0; overflow: auto; padding: 12px; }
```

> Use the CSS variables already defined in `index.css` (confirm the exact names for panel/line/amber/ink tokens and match them; the names above follow the mock but must be reconciled with the real tokens).

- [ ] **Step 6: Run the full suite + typecheck + lint**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: tests PASS (no references to the deleted drawer or `open`); typecheck clean; lint clean (pre-existing Galaxy3D/d3-force-3d `any` warnings are unrelated and allowed).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(chats): cut over to CHATS page, remove drawer + FAB"
```

---

## Task 7: End-to-end verification in dev

**Files:** none (manual verification).

- [ ] **Step 1: Launch**

Run: `pnpm dev` (or reload if running).

- [ ] **Step 2: Verify the migration**

Confirm each:
- CHATS nav item present at position `03`; Cmd+3 opens it; other Cmd+N still land on the right screens.
- No FAB anywhere; no slide-out drawer.
- Start a chat from Dashboard/Roadmap/Skills/Productivity entry points → app navigates to CHATS and the chat is active; nav badge shows the count.
- Left pane shows the conversation + composer; a running worker keeps streaming when you switch to another section and back (subscription intact).
- Drag the divider: panes resize, both stop at their minimum width; ratio persists across an app reload.
- Switch chat types: `idea incubator` shows saved idea cards as they're saved; `discuss results` shows the batch; `skill improver` shows the report; `worker` and `chat` show an empty right pane (Phase 2).
- Close a chat with its × → run stops, tab removed, badge decrements.

- [ ] **Step 3: Note any deviations** in the daily log / as follow-ups. No commit unless fixes are needed.

---

## Phase 2 (separate follow-up plan)

Not in this plan — tracked for a later spec/plan:
- **worker Canvas:** `Changes` (git diff of the working tree + deploy status via the existing `deployed` event), `Docs` (design/plan docs the agent writes), `Artifact` (rendered output).
- **general chat Canvas:** `Artifact` (render documents/code/HTML the assistant emits) + `Context` (files read & knowledge cited, derived from timeline tool events).
- Extend `tabsForType` to return these; add the data plumbing (new companion stores / tRPC queries scoped to the worker session).

---

## Self-Review

**Spec coverage:**
- Nav item + section → Task 1. Badge → Task 3. Split + draggable divider + min width + default 50/50 → Tasks 2 (ratio state) + 4 (SplitPane/clamp) + 6 (CSS). Store refactor (drop `open`, add `splitRatio`/`canvasTabByType`) → Tasks 2 + 6. Left overlays unchanged → Task 6. Canvas + per-type tabs → Task 5. Reuse views (Ideas/Results/Report) → Task 5. Empty state for bare chats → Tasks 5 (EmptyCanvas) + 6 (CSS). Remove drawer/FAB → Task 6. Deep-link/prefill still works → Task 2 (`goToChat`) + Task 7 (verify). worker/general Canvas data plumbing explicitly deferred → Phase 2 note. ✅ All Phase-1 spec items mapped.

**Placeholder scan:** No TBD/TODO in steps. The two `/* verbatim */` markers in Task 6 Step 1 are explicit copy-from-source instructions with exact line references, filled before the source is deleted in Step 4 — not open-ended placeholders. Implementer notes on `getBatch`/`ImproverReport`/CSS-token names flag real reconciliation points with a working fallback each.

**Type consistency:** `useChats`, `goToChat`, `ChatSessionType`, `splitRatio`/`setSplitRatio`, `canvasTabByType`/`setCanvasTab`, `mergePersistedChats`, `clampSplitRatio(ratio, containerPx, minPx)`, `tabsForType → CanvasTab[]`, `Canvas({ type })`, `savedItems` — names are consistent across Tasks 2–6. Persist version steps 2→3 (Task 2) →4 (Task 6) are monotonic.
