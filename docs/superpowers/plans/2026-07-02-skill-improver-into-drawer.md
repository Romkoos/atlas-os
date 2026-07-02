# Skill Improver into UnifiedChatDrawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the skill-improver chat render inside the shared `UnifiedChatDrawer` as a third session type, removing its inline Skills-page mounting so all three chats share one component.

**Architecture:** Add `skillImprover` to the `chatDrawer` store's type union (with a title-refresh fix for its reused singleton), extract the inline `ImproverOverlay` into a headless `SkillImproverOverlay` body, teach `UnifiedChatDrawer` the new type (endSession branch, body render, adaptive width), and rewire the Skills page so the editor is always shown and "Improve" opens the drawer.

**Tech Stack:** React 18, Zustand, tRPC (`@renderer/lib/trpc`), lucide-react, vitest, plain CSS in `src/renderer/src/index.css`.

## Global Constraints

- All UI strings in English.
- Styling uses custom CSS classes in `src/renderer/src/index.css` (project style), NOT Tailwind utilities.
- Do NOT modify `SkillImproverHost.tsx`, the improver tRPC router, or `skillImproverRun` store lifecycle actions (`start`/`reply`/`accept`/`reject`/`cancel`/`finish`/`reset`).
- Do NOT modify `BenchmarkChatHost.tsx` / `RoadmapChatHost.tsx`.
- Import alias is `@renderer/...`. Icons from `lucide-react`.
- Session `id === type` (one session per type). `openSession` idempotent per type; when the session already exists, refresh its title only if a new title is passed.
- Cancelling a session is owned by the drawer tab `×`; Accept/Reject/Send stay in the improver body.
- Commit steps are opt-in — skip them if the running policy forbids commits and leave changes in the working tree.
- Typecheck: `pnpm typecheck`. Tests: `pnpm test`. Build: `pnpm build`. Lint: `pnpm lint` (9 pre-existing `noExplicitAny` warnings in `Galaxy3D.tsx`/`d3-force-3d.d.ts` are unrelated and OK).

---

### Task 1: Extend `chatDrawer` store with `skillImprover` + title refresh

**Files:**
- Modify: `src/renderer/src/store/chatDrawer.ts`
- Test: `src/renderer/src/store/chatDrawer.test.ts`

**Interfaces:**
- Consumes: existing `useChatDrawer` store (from the prior feature).
- Produces:
  - `ChatSessionType = 'benchmark' | 'roadmap' | 'skillImprover'`
  - `DEFAULT_TITLES.skillImprover = 'improver'`
  - `openSession({ type, title? })` now refreshes an existing session's title to `title ?? existing.title`.

- [ ] **Step 1: Add the failing tests**

Append these cases to `src/renderer/src/store/chatDrawer.test.ts` (after the existing `describe` blocks; the file already resets state in `beforeEach`):

```ts
describe('useChatDrawer skillImprover + title refresh', () => {
  it('opens a third session type with a custom title', () => {
    useChatDrawer.getState().openSession({ type: 'benchmark' })
    useChatDrawer.getState().openSession({ type: 'roadmap' })
    useChatDrawer.getState().openSession({ type: 'skillImprover', title: 'improver · my-skill' })
    const s = useChatDrawer.getState()
    expect(s.sessions.map((x) => x.id)).toEqual(['benchmark', 'roadmap', 'skillImprover'])
    expect(s.sessions.find((x) => x.type === 'skillImprover')?.title).toBe('improver · my-skill')
    expect(s.activeSessionId).toBe('skillImprover')
  })

  it('defaults the skillImprover title to "improver" when none is passed', () => {
    useChatDrawer.getState().openSession({ type: 'skillImprover' })
    expect(useChatDrawer.getState().sessions[0].title).toBe('improver')
  })

  it('refreshes the title when re-opening an existing session with a new title', () => {
    useChatDrawer.getState().openSession({ type: 'skillImprover', title: 'improver · a' })
    useChatDrawer.getState().openSession({ type: 'skillImprover', title: 'improver · b' })
    const s = useChatDrawer.getState()
    expect(s.sessions).toHaveLength(1)
    expect(s.sessions[0].title).toBe('improver · b')
  })

  it('keeps the existing title when re-opening without a title', () => {
    useChatDrawer.getState().openSession({ type: 'benchmark' })
    useChatDrawer.setState((st) => ({ sessions: st.sessions.map((x) => ({ ...x, title: 'custom' })) }))
    useChatDrawer.getState().openSession({ type: 'benchmark' })
    expect(useChatDrawer.getState().sessions[0].title).toBe('custom')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/renderer/src/store/chatDrawer.test.ts`
Expected: FAIL — `'skillImprover'` is not assignable to `ChatSessionType`, and the title-refresh test fails because the existing branch drops `title`.

- [ ] **Step 3: Update the store**

In `src/renderer/src/store/chatDrawer.ts`, change the type union:

```ts
export type ChatSessionType = 'benchmark' | 'roadmap' | 'skillImprover'
```

Add the default title (extend the existing `DEFAULT_TITLES` map):

```ts
const DEFAULT_TITLES: Record<ChatSessionType, string> = {
  benchmark: 'discuss results',
  roadmap: 'idea incubator',
  skillImprover: 'improver',
}
```

Replace the `openSession` action with the title-refreshing version:

```ts
  openSession: ({ type, title }) =>
    set((s) => {
      const existing = s.sessions.find((x) => x.type === type)
      if (existing) {
        return {
          open: true,
          activeSessionId: existing.id,
          sessions: s.sessions.map((x) =>
            x.id === existing.id ? { ...x, title: title ?? x.title } : x,
          ),
        }
      }
      const session: ChatSession = { id: type, type, title: title ?? DEFAULT_TITLES[type] }
      return { open: true, sessions: [...s.sessions, session], activeSessionId: session.id }
    }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/renderer/src/store/chatDrawer.test.ts`
Expected: PASS (all cases, including the 6 pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/chatDrawer.ts src/renderer/src/store/chatDrawer.test.ts
git commit -m "feat(chat): add skillImprover session type + openSession title refresh"
```

---

### Task 2: Extract `SkillImproverOverlay` headless body

**Files:**
- Create: `src/renderer/src/components/SkillImproverOverlay.tsx`

**Interfaces:**
- Consumes: `useSkillImproverRun`, `trpc.skillImprover.reply/accept/reject`, `ImproverReportView`.
- Produces: `SkillImproverOverlay()` — **no props**; renders `.skill-improver-body` containing the improver transcript, `ImproverReportView`, and the reviewing (Accept/Reject) / running (reply input + Send) footers. No `.split-pane`/`.pane-head` chrome, no Stop button.

- [ ] **Step 1: Create the component**

Create `src/renderer/src/components/SkillImproverOverlay.tsx`:

```tsx
import { ImproverReportView } from '@renderer/components/ImproverReportView'
import { trpc } from '@renderer/lib/trpc'
import { useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { useEffect, useRef, useState } from 'react'

// Body of the skill-improver session, rendered inside UnifiedChatDrawer. Reads
// the App-level store, so the session survives tab switches / drawer collapse
// (the subscription lives in SkillImproverHost). Cancel is owned by the drawer
// tab ×; Accept/Reject/Send are improver-specific and stay here.
export function SkillImproverOverlay() {
  const run = useSkillImproverRun()
  const reply = trpc.skillImprover.reply.useMutation()
  const accept = trpc.skillImprover.accept.useMutation()
  const reject = trpc.skillImprover.reject.useMutation()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin whenever streamed content changes
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run.transcript, run.streaming, run.report])

  function send() {
    const text = draft.trim()
    if (!text || !run.requestId) return
    run.pushUserReply(text)
    reply.mutate({ requestId: run.requestId, text })
    setDraft('')
  }

  return (
    <div className="skill-improver-body">
      <div className="improver">
        <div className="improver-transcript" ref={scrollRef}>
          {run.transcript.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only
            <div key={i} className={`improver-entry ${e.kind}`}>
              {e.kind === 'tool' ? `⚙ ${e.text}` : e.text}
            </div>
          ))}
          {run.streaming ? <div className="improver-entry">{run.streaming}</div> : null}
          {run.report ? (
            <div style={{ marginTop: 16 }}>
              <ImproverReportView report={run.report} />
            </div>
          ) : null}
        </div>

        {run.status === 'reviewing' ? (
          <div className="improver-foot">
            <button
              type="button"
              className="btn"
              disabled={accept.isPending || reject.isPending || !run.requestId}
              onClick={() => run.requestId && accept.mutate({ requestId: run.requestId })}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn"
              disabled={accept.isPending || reject.isPending || !run.requestId}
              onClick={() => run.requestId && reject.mutate({ requestId: run.requestId })}
            >
              Reject
            </button>
          </div>
        ) : run.running ? (
          <div className="improver-foot">
            <input
              className="input"
              placeholder={run.awaitingInput ? 'Type your reply…' : 'thinking…'}
              disabled={!run.awaitingInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button type="button" className="btn" disabled={!run.awaitingInput} onClick={send}>
              Send
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. The new file is self-contained and exported; `Skills.tsx` still has its own `ImproverOverlay` (unchanged, untouched until Task 4) so nothing breaks.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/SkillImproverOverlay.tsx
git commit -m "feat(chat): add headless SkillImproverOverlay drawer body"
```

---

### Task 3: Teach `UnifiedChatDrawer` the `skillImprover` type

**Files:**
- Modify: `src/renderer/src/components/UnifiedChatDrawer.tsx`

**Interfaces:**
- Consumes: `SkillImproverOverlay` (Task 2), `useSkillImproverRun` (`getState()` → `requestId`/`running`/`reset()`), `trpc.skillImprover.cancel` (input `{ requestId }`), `ChatSessionType` now including `skillImprover` (Task 1).
- Produces: drawer renders `<SkillImproverOverlay />` for the `skillImprover` tab, `endSession` cancels+resets the improver run, and the panel widens (`wide` class) when the improver tab is active.

- [ ] **Step 1: Add the imports**

In `src/renderer/src/components/UnifiedChatDrawer.tsx`, add after the existing `RoadmapChatOverlay` import and the `useRoadmapChatRun` import respectively (keep the grouped order):

```tsx
import { SkillImproverOverlay } from '@renderer/components/SkillImproverOverlay'
```
```tsx
import { useSkillImproverRun } from '@renderer/store/skillImproverRun'
```

- [ ] **Step 2: Add the cancel mutation and the third `endSession` branch**

Add the improver cancel mutation next to the other two:

```tsx
  const benchCancel = trpc.benchmarkChat.cancel.useMutation()
  const roadmapCancel = trpc.roadmapChat.cancel.useMutation()
  const skillCancel = trpc.skillImprover.cancel.useMutation()
```

Replace the existing `endSession` (the current `if (type === 'benchmark') { … } else { … roadmap … }`) with the three-branch version:

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
    } else {
      const st = useSkillImproverRun.getState()
      if (st.requestId && st.running) skillCancel.mutate({ requestId: st.requestId })
      st.reset()
    }
    closeSession(type)
  }
```

- [ ] **Step 3: Add the `wide` flag and render the improver body**

Change the `active` line to also compute `wide`:

```tsx
  const active = sessions.find((s) => s.id === activeSessionId)
  const wide = active?.type === 'skillImprover'
```

Change the `<aside>` opening tag to append the `wide` class:

```tsx
      <aside className={`chat-drawer${open ? ' open' : ''}${wide ? ' wide' : ''}`} aria-hidden={!open}>
```

Add the third body branch inside `.chat-drawer-body`:

```tsx
        <div className="chat-drawer-body">
          {active?.type === 'benchmark' ? <BenchmarkChatOverlay /> : null}
          {active?.type === 'roadmap' ? <RoadmapChatOverlay /> : null}
          {active?.type === 'skillImprover' ? <SkillImproverOverlay /> : null}
        </div>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (The `wide` class has no visual effect until the CSS lands in Task 5 — that is expected and not an error. No Skills-page path opens a `skillImprover` tab yet; that is wired in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/UnifiedChatDrawer.tsx
git commit -m "feat(chat): render skillImprover in drawer with adaptive width"
```

---

### Task 4: Rewire Skills page to use the drawer

**Files:**
- Modify: `src/renderer/src/pages/Skills.tsx`

**Interfaces:**
- Consumes: `useChatDrawer.openSession` (Task 1).
- Produces: the "Improve" button opens the `skillImprover` drawer tab; the Skills right column always shows `SkillEditorPane`; the inline `ImproverOverlay` and its imports are gone.

- [ ] **Step 1: Swap imports**

In `src/renderer/src/pages/Skills.tsx`:

Remove the `ImproverReportView` import (currently line 1):

```tsx
import { ImproverReportView } from '@renderer/components/ImproverReportView'
```

Add the drawer-store import in the `@renderer/store` group (next to the `useSkillImproverRun` import):

```tsx
import { useChatDrawer } from '@renderer/store/chatDrawer'
```

(Leave `import { useEffect, useRef, useState } from 'react'` unchanged — all three are still used by `SkillEditorPane`. Leave the `trpc` and `useSkillImproverRun` imports — still used by `SkillEditorPane`.)

- [ ] **Step 2: Open the drawer from "Improve"**

Replace the `startImprove` function (currently lines ~88-94 inside `SkillEditorPane`):

```tsx
  function startImprove() {
    if (improverRunning) {
      toast.error('An improvement is already running')
      return
    }
    startImprover(skillId)
  }
```

with:

```tsx
  function startImprove() {
    if (improverRunning) {
      toast.error('An improvement is already running')
      return
    }
    startImprover(skillId)
    useChatDrawer.getState().openSession({
      type: 'skillImprover',
      title: `improver · ${skillId}`,
    })
  }
```

- [ ] **Step 3: Delete the inline `ImproverOverlay`**

Remove the entire `ImproverOverlay` function (currently lines ~260-357, from `function ImproverOverlay({ skillId }: { skillId: string }) {` through its closing `}` before the `SelectedRight` comment).

- [ ] **Step 4: Simplify `SelectedRight` to always show the editor**

Replace the `SelectedRight` function (currently lines ~359-378) with:

```tsx
// The editor is always shown for the selected skill; the improver session now
// lives in the UnifiedChatDrawer. The editor auto-refreshes after accept/reject
// because SkillImproverHost invalidates skills.getRaw on done/aborted.
function SelectedRight({ selectedId }: { selectedId: string }) {
  return <SkillEditorPane key={selectedId} skillId={selectedId} />
}
```

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck`
Expected: PASS with zero errors — no remaining references to `ImproverOverlay`, `ImproverReportView`, or `trpc.skillImprover.reply/accept/reject/cancel` in `Skills.tsx`; `useEffect`/`useRef`/`useState`/`useSkillImproverRun`/`trpc` all still used.

Run: `pnpm lint`
Expected: PASS (only the pre-existing unrelated warnings).

If any unused-import/unused-variable error appears (e.g. a leftover reference), fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/pages/Skills.tsx
git commit -m "feat(chat): open skill improver in drawer; editor always shown"
```

---

### Task 5: Drawer body + adaptive-width styles

**Files:**
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes: the existing `.improver` / `.improver-transcript` / `.improver-foot` rules (already `flex: 1; min-height: 0` — they fill and scroll inside a flex-column parent) and the existing `.chat-drawer` rules.
- Produces: `.skill-improver-body` (flex-column fill) and `.chat-drawer.wide` (560px), with `width` added to the drawer transitions.

- [ ] **Step 1: Add `.skill-improver-body` next to the other chat-body rules**

In `src/renderer/src/index.css`, immediately after the existing `.bench-chat-body, .rm-chat-body { … }` rule (inside `@layer components`), add:

```css
  .skill-improver-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
```

- [ ] **Step 2: Add `width` to the `.chat-drawer` transitions**

Find the existing `.chat-drawer` rule and change its `transition` to include `width`:

```css
    transition:
      transform 0.24s ease,
      width 0.24s ease,
      visibility 0s linear 0.24s;
```

Find the existing `.chat-drawer.open` rule and change its `transition` to include `width`:

```css
    transition:
      transform 0.24s ease,
      width 0.24s ease;
```

- [ ] **Step 3: Add the `wide` modifier**

Immediately after the `.chat-drawer.open { … }` rule, add:

```css
  .chat-drawer.wide {
    width: 560px;
  }
```

- [ ] **Step 4: Verify build + lint**

Run: `pnpm build`
Expected: PASS (typecheck + electron-vite build).

Run: `pnpm lint`
Expected: PASS (only the pre-existing unrelated warnings).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/index.css
git commit -m "style(chat): skill-improver drawer body + adaptive drawer width"
```

---

### Task 6: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: `chatDrawer.test.ts` passes (now 10 cases). The only failures should be the pre-existing `src/main/services/graph/store.test.ts` better-sqlite3 ABI mismatch under plain Node — unrelated to this branch.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Drive the app (use `/run` or `pnpm dev`) and confirm:**

- Selecting a skill and clicking "Improve" opens the drawer with an `improver · <id>` tab, and the transcript streams.
- The drawer is visibly wider on the improver tab and narrows when switching to a benchmark/roadmap tab.
- Accept/Reject appear when the report arrives; clicking one finishes the run and the Skills editor refreshes to the applied/reverted content (editor stays visible in the right column throughout).
- Benchmark, roadmap, and improver can all be open as three tabs and switch correctly.
- The improver tab's `×` cancels a running improvement and removes the tab; closing the last tab hides the drawer.
- Starting an improvement on a different skill after a previous one finished updates the tab title to the new skill.

- [ ] **Step 4: Commit any fixes surfaced by verification** (skip if none)

```bash
git add -A
git commit -m "fix(chat): address issues found during skill-improver drawer verification"
```

---

## Self-Review

**Spec coverage:**
- `chatDrawer` type union + `skillImprover` default title + title-refresh fix → Task 1. ✓
- Extract `ImproverOverlay` → headless `SkillImproverOverlay`, drop split-pane/pane-head/Stop → Task 2. ✓
- Drawer endSession branch + body render + adaptive width → Task 3. ✓
- Skills page: always-editor, remove inline improver, wire `openSession`, remove terminal reset → Task 4. ✓
- CSS `.skill-improver-body` + `.chat-drawer.wide` + width transition → Task 5. ✓
- Hosts / improver store lifecycle unchanged → Global Constraints; no task touches them. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows full code. ✓

**Type consistency:** `ChatSessionType` includes `skillImprover` in Tasks 1/3/4; `openSession({ type, title? })` signature identical across tasks; `endSession` uses `useSkillImproverRun.getState()` fields `requestId`/`running`/`reset` (present in the store); cancel input `{ requestId }` matches the extracted body's usage; `.skill-improver-body`/`.chat-drawer.wide` class names match Task 2/3 markup. ✓
