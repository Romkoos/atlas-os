# Worker Chat + Chat UI Upgrades — Design

Date: 2026-07-03
Branch: `feat/worker-chat`

## Summary

Add a fifth chat type — **Worker** — a full-power chat that can edit code, and
upgrade the shared chat UI so every chat type benefits from: markdown-formatted
output, a collapsible tool-call widget with a loader and real tool output,
clickable option chips when the model offers choices, and an input composer that
is always pinned to the bottom (even when the transcript is empty). The FAB and
the drawer's `+` button become type pickers (General vs Worker).

This is one spec covering one new feature plus four cross-cutting UI upgrades
that land in all five chat types via a shared rendering layer.

## Context (existing architecture)

- Domain-agnostic drawer store: `src/renderer/src/store/chatDrawer.ts`
  (`ChatSessionType = 'benchmark' | 'roadmap' | 'skillImprover' | 'generalChat'`;
  invariant `session.id === session.type`, one session per type).
- Drawer + tab strip + FAB + `+`: `src/renderer/src/components/UnifiedChatDrawer.tsx`
  (icons from `lucide-react`, already imports `MessageSquare, Plus, X`).
- Per-type overlays: `GeneralChatOverlay.tsx`, `RoadmapChatOverlay.tsx`,
  `BenchmarkChatOverlay.tsx`, `SkillImproverOverlay.tsx`. Each has its own inline
  transcript loop — there is **no** shared message component today.
- Renderer run stores via `createChatRunStore.ts` factory
  (`ChatEntry = { kind: 'assistant' | 'tool' | 'user'; text }`).
- Always-mounted `ChatHost.tsx` translates transport events → store mutations.
- Main side: `ChatSessionRegistry` (`src/main/services/chat/registry.ts`) +
  generic SDK driver `resumableRun.ts` (`startResumableChat`, streaming-input via
  a `Mailbox`). Events defined in `src/shared/ipc-events.ts` (`BaseChatEvent`).
- Per-type tRPC routers in `src/main/trpc/routers/{generalChat,roadmapChat,benchmarkChat}.ts`
  each pass a `CHAT_TOOLS` allow-list; `permissionMode` is currently hardcoded to
  `bypassPermissions` inside `resumableRun.ts`.
- Today tool-use is collapsed to a one-line `· <summary>` string; tool **results**
  are never surfaced; there is no markdown and no option/choice UI anywhere.

## Decisions (locked with the user)

1. **Worker safety**: auto-apply (`bypassPermissions`), no approval prompts, cwd =
   repo root (`app.getAppPath()`), tools =
   `['Read','Write','Edit','Bash','Glob','Grep','Task','TodoWrite']`. No first-run
   confirmation.
2. **Tool widget**: full fidelity — emit both tool-use and tool-result, pair them,
   collapsible card with a loader while running and the real output on expand.
3. **Rollout**: all chats, via a shared `<ChatTranscript>` / `<ChatComposer>`
   component (refactor the duplicated overlay loops).
4. **Option choices**: turn-boundary chips (NOT the real `AskUserQuestion` tool).

## Components

### 1. Shared rendering layer — `src/renderer/src/components/chat/`

Consumed by all five overlays.

- **`ChatTranscript.tsx`** — props `{ transcript: ChatEntry[]; streaming: string }`.
  - `assistant` / `user` entries → `<Markdown>` (react-markdown + remark-gfm; both
    already deps, used in `pages/Skills.tsx`).
  - `tool` entries → `<ToolCallCard>`.
  - Live `streaming` string → an in-progress assistant bubble (markdown).
  - After the last assistant turn, if that turn carried an options block, render
    `<OptionChips>`.
- **`ToolCallCard.tsx`** — props `{ entry }` where the tool entry has
  `{ id, text (summary), status, resultText? }`. Header row: tool icon +
  summary + status indicator (`Loader2` spinning while `running`, `Check` when
  `done`, `X` on error). Click toggles a body region showing `resultText`
  (monospace, scrollable, truncated with a max height). Local `expanded` state.
- **`ChatComposer.tsx`** — props `{ disabled; awaiting; onSend(text) }`. Textarea +
  send button. Rendered as a `flex-none` footer inside a `flex-col` overlay body so
  it is **always at the bottom**, including when the transcript is empty. Enter to
  send, Shift+Enter for newline. Disabled while running / not awaiting input.
- **`OptionChips.tsx`** — props `{ options: string[]; onPick(text) }`. Renders each
  option as a button; click calls `onPick`, which the overlay wires to `reply`.

Styling added to `src/renderer/src/index.css` under the existing `.rm-chat-*`
namespace (markdown typography, tool card, chips). Respect the Tailwind
`mt-*` unlayered-utility gotcha; keep spacing consistent with existing chat CSS.

### 2. Tool-use ↔ tool-result plumbing

- `ChatEntry` (`createChatRunStore.ts`): the `tool` variant gains
  `id: string`, `status: 'running' | 'done' | 'error'`, `resultText?: string`.
- `BaseChatEvent` (`src/shared/ipc-events.ts`):
  - existing `tool` event carries `toolId` + `summary`.
  - new `tool-result` event: `{ type: 'tool-result'; toolId: string; resultText: string; isError: boolean }`.
- `resumableRun.ts`: in addition to reading `tool_use` blocks from assistant
  messages (emit `tool` with `toolId = block.id`), read `tool_result` blocks from
  user-role SDK messages and emit `tool-result` keyed by the same id. Truncate very
  large results to a sane cap before sending.
- Run store gains `pushTool(id, summary)` (creates entry, status `running`) and
  `resolveTool(id, resultText, isError)` (sets status `done`/`error` + `resultText`).
  `flushTurn`/`finish` mark any still-`running` tool `done` so no spinner sticks.
- `ChatHost.tsx` onData switch: `tool` → `pushTool`; `tool-result` → `resolveTool`.

### 3. Clickable options (turn-boundary chips)

- Each drawer chat's `appendSystemPrompt` gains an instruction: when offering the
  user a choice, end the turn with a fenced block:

  ````
  ```options
  Rewrite in place
  New module
  Skip
  ```
  ````

- The **renderer** parses the last assistant entry: a small `parseOptions(text)`
  util extracts the fenced `options` block (returns `{ display, options[] }`,
  stripping the block from the shown text). `ChatTranscript` renders `<OptionChips>`
  for it at the turn boundary. Clicking a chip calls the overlay's existing `reply`
  mutation with the chosen text. No main-side change, no `AskUserQuestion` tool
  (which would block mid-turn with no result channel).

### 4. Worker chat type (mirrors `generalChat`)

- `chatDrawer.ts`: add `'worker'` to `ChatSessionType`, `DEFAULT_TITLES`
  (`'Worker'`), `VALID_TYPES`; bump persist `version` so old persisted drawer state
  re-sanitizes.
- `src/renderer/src/store/workerChatRun.ts`:
  `export const useWorkerChatRun = createChatRunStore('atlas-chat-run-worker')`.
- `src/renderer/src/components/WorkerChatOverlay.tsx`: thin overlay composing
  `<ChatTranscript>` + `<ChatComposer>`, wired to `useWorkerChatRun` + the
  `workerChat.reply` mutation. (Once the shared components exist, all overlays
  become thin; roadmap/benchmark/improver keep their sidecar stores.)
- `App.tsx`: add
  `<ChatHost useRun={useWorkerChatRun} useOpenSubscription={trpc.workerChat.open.useSubscription} kickoff=... />`.
- `src/main/trpc/routers/workerChat.ts` (clone `generalChat.ts`):
  `CHAT_TOOLS = ['Read','Write','Edit','Bash','Glob','Grep','Task','TodoWrite']`;
  register in the root router.
- `src/main/services/chat/workerChat/run.ts`: `buildRun` → `startResumableChat`
  with worker tools, `cwd` = repo root, `subscriptionEnv()` (strip API key → OAuth),
  and the worker persona + options-convention `appendSystemPrompt`.
- `permissionMode`: reuse the hardcoded `bypassPermissions` in `resumableRun.ts`.
  The broadened allow-list is what unlocks edits; no thread-through needed.

### 5. FAB + `+` type picker (`UnifiedChatDrawer.tsx`)

- Add a `Wrench` import from `lucide-react` for the worker.
- Small local `pickerOpen` state + a two-icon picker rendered as a popover / stack:
  `MessageSquare` → open General, `Wrench` → open Worker.
- **FAB** with zero sessions: click toggles the picker (two icon buttons) instead of
  directly opening a general chat. With sessions present, keep current behavior.
- **`+`** button in the drawer header: opens the same two-icon picker instead of the
  current hardcoded `openGeneralChat()`.
- `openWorker()` helper mirrors `openGeneralChat()` →
  `useChatDrawer.getState().openSession({ type: 'worker' })`.
- Extend the body switch and `endSession` switch to include `worker`.

## Data flow

```
Page / FAB / +  ──openSession({type})──▶ chatDrawer store (tabs)
                                         │
WorkerChatOverlay ──start/reply──▶ workerChatRun store ──subscription input──▶ ChatHost
ChatHost ──trpc.workerChat.open──▶ registry.open ──buildRun──▶ startResumableChat (SDK, bypass, full tools)
SDK messages ──▶ resumableRun maps:
   content_block_delta  ▶ token        ▶ appendToken
   tool_use             ▶ tool         ▶ pushTool(id, summary)   [status running → spinner]
   tool_result          ▶ tool-result  ▶ resolveTool(id, text)   [status done → ✓ + expandable output]
   result:success       ▶ awaiting-input ▶ flushTurn + setAwaiting  [chips parsed from last turn]
```

## Error handling

- `tool-result` with `isError` → card renders error state (red header, output on
  expand).
- Turn ends with a tool still `running` → mark it `done` (no stuck spinner).
- Large tool results truncated (cap in `resumableRun`) with a "…truncated" note.
- Options parsing is defensive: no fenced block → no chips (normal turn).
- Worker runs under `bypassPermissions` at repo root — document the blast radius in
  the router; no runtime confirmation per the locked decision.
- Persist `version` bump prevents a stale drawer state from referencing a removed
  type.

## Testing

- **Unit**: `parseOptions` (extract + strip, malformed block); run-store
  `pushTool`/`resolveTool` (running → done/error, still-running-at-finish cleanup).
- **Component**: `ToolCallCard` (loader/done/error + expand toggle); `ChatComposer`
  (sticky bottom with empty transcript, Enter vs Shift+Enter, disabled while
  running); `OptionChips` (click → onPick).
- **e2e** (playwright, brand-string style like existing tests): FAB with no sessions
  shows two icons; clicking the wrench opens a Worker tab.
- **Manual**: real worker edit on a scratch file at repo root; verify markdown,
  a tool card expanding to show output, and an options turn rendering chips.

## Out of scope

- True mid-turn `AskUserQuestion` tool support (turn-boundary chips instead).
- Interactive per-edit approval for the worker (auto-apply chosen).
- Worker targeting an arbitrary user-picked project (repo root only).
