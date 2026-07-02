# Skill Improver into UnifiedChatDrawer — Design

Date: 2026-07-02

## Goal

Make the skill-improver chat use the same `UnifiedChatDrawer` as the benchmark
and roadmap chats, so all three chats share one component. Today the improver
renders inline in the Skills page right column (`SelectedRight` swaps the editor
for `ImproverOverlay`); this moves it into the drawer as a third session type.

## Non-goals

- No changes to the improver tRPC router, `SkillImproverHost` subscription, or
  `skillImproverRun` store lifecycle actions (`start`/`reply`/`accept`/`reject`/
  `cancel`/`finish`/`reset`).
- No new chat types beyond adding `skillImprover`.
- No redesign of `ImproverReportView` itself.

## Architecture

### 1. `store/chatDrawer.ts`

- Extend `ChatSessionType` to `'benchmark' | 'roadmap' | 'skillImprover'`.
- Add `DEFAULT_TITLES.skillImprover = 'improver'`.
- **`openSession` title refresh (bug fix):** when a session of the requested
  type already exists, update its `title` if a new one was passed:
  `title: title ?? existing.title`. The improver store is a singleton reused
  across skills while the single `skillImprover` tab (id === type) persists, so
  without this the tab would keep a stale `improver · <old skill>` title after
  starting a new skill. Benchmark/roadmap pass no title, so their behavior is
  unchanged (default title re-applied to itself, a no-op).

### 2. `components/SkillImproverOverlay.tsx` (new; extracted from Skills.tsx)

- Move `ImproverOverlay` out of `Skills.tsx` into this file, export as
  `SkillImproverOverlay`, taking **no props** (reads `skillId` and run state
  from `useSkillImproverRun`).
- Remove the outer `.split-pane` wrapper and the `.pane-head` header (the drawer
  supplies the tab strip / title). Wrap the body in `.skill-improver-body`.
- Keep: the transcript + streaming, `ImproverReportView` (rendered when
  `run.report`), the `reviewing` footer (Accept / Reject), and the `running`
  footer (reply input + Send).
- **Remove the "Stop" button** — cancelling is now owned by the drawer tab `×`
  (consistent with benchmark/roadmap). Accept/Reject/Send stay in the body
  because they are improver-specific and the drawer does not know about them.
- Move the `ImproverReportView` import into this file.

### 3. `components/UnifiedChatDrawer.tsx`

- `endSession`: add a `skillImprover` branch — cancel via
  `trpc.skillImprover.cancel` (guarded by `requestId && running`) +
  `useSkillImproverRun.getState().reset()`, then `closeSession(type)`.
- Body render: add `active?.type === 'skillImprover' ? <SkillImproverOverlay />`.
- Adaptive width: compute `wide = active?.type === 'skillImprover'` and add a
  `wide` modifier class to the drawer `<aside>`.

### 4. `pages/Skills.tsx`

- `SelectedRight`: always render `<SkillEditorPane key={selectedId} skillId={selectedId} />`.
  Remove the improver branching, the `isActive`/`isTerminal` logic, the
  terminal-`reset()` `useEffect`, and the now-unused store selectors
  (`status`/`runSkillId`/`reset`). The editor auto-refreshes after accept/reject
  because `SkillImproverHost` already invalidates `skills.getRaw` on
  done/aborted.
- Remove the `ImproverOverlay` definition (extracted) and any now-unused imports
  (`ImproverReportView`, and the improver tRPC mutations used only there).
- The "improve" trigger: after `startImprover(skillId)`, also call
  `useChatDrawer.getState().openSession({ type: 'skillImprover', title: `improver · ${skillId}` })`.
  Keep the existing `improverRunning` guard. Add the `useChatDrawer` import.

### 5. Styling (`index.css`)

- Add `.skill-improver-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }`
  plus rules so `.improver` / `.improver-transcript` fill the drawer body and
  scroll (`.skill-improver-body .improver { flex: 1; min-height: 0; }` etc.).
- Add `.chat-drawer.wide { width: 560px; }` and add `width` to the `.chat-drawer`
  (and `.chat-drawer.open`) transitions so the width animates when switching to
  the improver tab.

## Testing / verification

- `chatDrawer.test.ts`: add a case for `openSession({ type: 'skillImprover', title })`
  (third tab coexists; custom title honored) and title-refresh on re-open.
- `pnpm build` (typecheck + electron-vite) and `pnpm lint` pass.
- Manual: improve a skill → an `improver · <id>` tab opens in the drawer and
  streams; Accept/Reject work and the editor refreshes; the drawer widens on the
  improver tab and narrows on benchmark/roadmap; tab `×` cancels a running
  improver run and removes the tab; benchmark + roadmap + improver can coexist as
  three tabs.
