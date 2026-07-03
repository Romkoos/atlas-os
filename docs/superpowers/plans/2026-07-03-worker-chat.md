# Worker Chat + Chat UI Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-power "Worker" chat type that can edit code, and upgrade the shared chat UI (markdown output, collapsible tool cards with loaders + real output, clickable option chips, sticky-bottom composer) across every chat type.

**Architecture:** A new shared rendering layer (`components/chat/`) replaces the duplicated per-overlay transcript loops. Tool-use↔tool-result pairing is plumbed from `resumableRun` → `ChatHost` → run store → `ToolCallCard`. Options are parsed renderer-side from a fenced ```options block the model emits at a turn boundary. The Worker type mirrors the `generalChat` seams with a broadened tool allow-list under `bypassPermissions` at repo root.

**Tech Stack:** Electron + React + TypeScript, zustand (persist), tRPC subscriptions, `@anthropic-ai/claude-agent-sdk` (streaming-input), `react-markdown` + `remark-gfm`, `lucide-react`, vitest, playwright.

## Global Constraints

- All UI strings and agent prompts are **English only** (per project rule).
- Worker permission model (locked): `permissionMode: bypassPermissions`, `cwd = app.getAppPath()` (repo root), `allowedTools = ['Read','Write','Edit','Bash','Glob','Grep','Task','TodoWrite']`, no runtime confirmation.
- One session per type; `session.id === session.type` (drawer invariant).
- `running` and `streaming` are never persisted in run stores.
- Markdown usage matches the existing pattern: `import Markdown from 'react-markdown'; import remarkGfm from 'remark-gfm'; <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>`.
- Test runner: `pnpm test` (vitest, `vitest run`). E2e: `pnpm e2e` (playwright, specs in `e2e/`).
- Commit frequently; end commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Ignore the `git-commit-message` skill (it targets a different repo).

---

### Task 1: `parseOptions` util (turn-boundary option chips)

**Files:**
- Create: `src/renderer/src/components/chat/parseOptions.ts`
- Test: `src/renderer/src/components/chat/parseOptions.test.ts`

**Interfaces:**
- Produces: `parseOptions(text: string): { display: string; options: string[] }` — extracts a fenced ```options block, returns the remaining text (`display`, trimmed) and one option per non-empty line. No block → `{ display: text, options: [] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/renderer/src/components/chat/parseOptions.test.ts
import { describe, expect, it } from 'vitest'
import { parseOptions } from './parseOptions'

describe('parseOptions', () => {
  it('returns the text unchanged with no options when there is no block', () => {
    expect(parseOptions('just a normal answer')).toEqual({
      display: 'just a normal answer',
      options: [],
    })
  })

  it('extracts options and strips the block from the display text', () => {
    const text = 'Which approach?\n\n```options\nRewrite in place\nNew module\nSkip\n```'
    expect(parseOptions(text)).toEqual({
      display: 'Which approach?',
      options: ['Rewrite in place', 'New module', 'Skip'],
    })
  })

  it('ignores blank lines and trims each option', () => {
    const text = 'Pick:\n```options\n  A  \n\n  B\n```'
    expect(parseOptions(text)).toEqual({ display: 'Pick:', options: ['A', 'B'] })
  })

  it('treats a block with no lines as no options', () => {
    expect(parseOptions('Hi\n```options\n```')).toEqual({ display: 'Hi', options: [] })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/renderer/src/components/chat/parseOptions.test.ts`
Expected: FAIL — cannot find module `./parseOptions`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/renderer/src/components/chat/parseOptions.ts
// Turn-boundary option chips: the model ends a turn that offers choices with a
// fenced ```options block. We strip that block from the shown text and render
// each remaining line as a clickable chip whose text becomes the next reply.
const OPTIONS_BLOCK = /```options\s*\n([\s\S]*?)```/i

export function parseOptions(text: string): { display: string; options: string[] } {
  const match = text.match(OPTIONS_BLOCK)
  if (!match) return { display: text, options: [] }
  const options = match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const display = text.replace(OPTIONS_BLOCK, '').trim()
  return { display, options }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/renderer/src/components/chat/parseOptions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/parseOptions.ts src/renderer/src/components/chat/parseOptions.test.ts
git commit -m "feat(chat): parseOptions util for turn-boundary option chips"
```

---

### Task 2: Tool event types + run-store tool-result pairing

**Files:**
- Modify: `src/shared/ipc-events.ts:5-11` (BaseChatEvent)
- Modify: `src/renderer/src/store/createChatRunStore.ts` (ChatEntry, interface, reducers)
- Test: `src/renderer/src/store/createChatRunStore.test.ts` (append cases)

**Interfaces:**
- Produces (shared): `BaseChatEvent` gains `{ type: 'tool'; name: string; summary: string; toolId: string }` (toolId added) and `{ type: 'tool-result'; toolId: string; resultText: string; isError: boolean }`.
- Produces (store): `ChatEntry` tool variant `{ kind: 'tool'; text: string; id: string; status: 'running' | 'done' | 'error'; resultText?: string }`. Non-tool entries keep `{ kind: 'assistant' | 'user'; text: string }`. New actions `pushTool(id: string, summary: string)` and `resolveTool(id: string, resultText: string, isError: boolean)`. `flushTurn`/`finish` mark any still-`running` tool entry `done`.

- [ ] **Step 1: Write the failing tests** (append to existing `createChatRunStore.test.ts`)

```ts
// append inside createChatRunStore.test.ts
describe('tool entries', () => {
  it('pushTool adds a running tool entry and resolveTool completes it', () => {
    const useRun = createChatRunStore('test-tool-1')
    useRun.getState().start('hi')
    useRun.getState().pushTool('t1', 'Read: store.ts')
    let tool = useRun.getState().transcript.find((e) => e.kind === 'tool')
    expect(tool).toMatchObject({ kind: 'tool', id: 't1', status: 'running', text: 'Read: store.ts' })

    useRun.getState().resolveTool('t1', 'file contents', false)
    tool = useRun.getState().transcript.find((e) => e.kind === 'tool')
    expect(tool).toMatchObject({ id: 't1', status: 'done', resultText: 'file contents' })
  })

  it('resolveTool with isError marks the entry as error', () => {
    const useRun = createChatRunStore('test-tool-2')
    useRun.getState().start('hi')
    useRun.getState().pushTool('t1', 'Bash: ls')
    useRun.getState().resolveTool('t1', 'boom', true)
    expect(useRun.getState().transcript.find((e) => e.kind === 'tool')).toMatchObject({
      status: 'error',
      resultText: 'boom',
    })
  })

  it('finish marks a still-running tool as done', () => {
    const useRun = createChatRunStore('test-tool-3')
    useRun.getState().start('hi')
    useRun.getState().pushTool('t1', 'Read: x')
    useRun.getState().finish('done')
    expect(useRun.getState().transcript.find((e) => e.kind === 'tool')).toMatchObject({
      status: 'done',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/renderer/src/store/createChatRunStore.test.ts`
Expected: FAIL — `pushTool` now takes 2 args / `resolveTool` undefined / status missing.

- [ ] **Step 3: Update `BaseChatEvent`** (`src/shared/ipc-events.ts`)

Replace the `tool` line and add `tool-result`:

```ts
export type BaseChatEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; summary: string; toolId: string }
  | { type: 'tool-result'; toolId: string; resultText: string; isError: boolean }
  | { type: 'awaiting-input' }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'aborted' }
```

(Also update `ImproverEvent`'s `tool` member at line 41 to include `toolId: string`, and `GraphDeepMapEvent`'s `tool` member at line 64, to keep the union assignable — search for `type: 'tool'; name` and add `toolId: string` to each.)

- [ ] **Step 4: Update the run store** (`src/renderer/src/store/createChatRunStore.ts`)

Replace the `ChatEntry` type (lines 4-7):

```ts
export type ChatEntry =
  | { kind: 'assistant' | 'user'; text: string }
  | { kind: 'tool'; text: string; id: string; status: 'running' | 'done' | 'error'; resultText?: string }
```

In `BaseChatRunState` (lines 22-23) replace the `pushTool` signature and add `resolveTool`:

```ts
  pushTool: (id: string, summary: string) => void
  resolveTool: (id: string, resultText: string, isError: boolean) => void
```

Replace the `pushTool` reducer (lines 103-104) and add `resolveTool`:

```ts
        pushTool: (id, summary) =>
          set((s) => ({
            transcript: [...s.transcript, { kind: 'tool', id, text: summary, status: 'running' }],
          })),
        resolveTool: (id, resultText, isError) =>
          set((s) => ({
            transcript: s.transcript.map((e) =>
              e.kind === 'tool' && e.id === id
                ? { ...e, status: isError ? 'error' : 'done', resultText }
                : e,
            ),
          })),
```

In `flushTurn` (lines 96-102) and `finish` (line 112), mark stuck tools done. Add this helper above the store return and use it. Simplest: update `finish` to sweep:

```ts
        finish: (status) =>
          set((s) => ({
            running: false,
            awaitingInput: false,
            status,
            transcript: s.transcript.map((e) =>
              e.kind === 'tool' && e.status === 'running' ? { ...e, status: 'done' } : e,
            ),
          })),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run src/renderer/src/store/createChatRunStore.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (the `pushTool`/`tool` event changes are consumed in Tasks 3-4; if `ChatHost.tsx` errors here, that is expected and fixed in Task 4 — if you are running tasks in order, complete Task 4 before the final typecheck gate).

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc-events.ts src/renderer/src/store/createChatRunStore.ts src/renderer/src/store/createChatRunStore.test.ts
git commit -m "feat(chat): tool-result event + running/done tool entries in run store"
```

---

### Task 3: Emit toolId + tool-result from the SDK driver

**Files:**
- Modify: `src/main/services/chat/resumableRun.ts:64-69` (assistant tool_use → add toolId) and add a `user` message branch for `tool_result`.

**Interfaces:**
- Consumes: `BaseChatEvent` with `tool` (now `toolId`) and `tool-result` (Task 2).
- Produces: emits `{ type: 'tool', name, summary, toolId }` on `tool_use` and `{ type: 'tool-result', toolId, resultText, isError }` on `tool_result`.

- [ ] **Step 1: Update the assistant `tool_use` emit** (lines 64-69)

```ts
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            opts.emit({
              type: 'tool',
              name: block.name,
              summary: summarizeTool(block),
              toolId: block.id,
            })
          }
        }
      } else if (message.type === 'user') {
        const content = message.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              opts.emit({
                type: 'tool-result',
                toolId: block.tool_use_id,
                resultText: toolResultText(block.content),
                isError: block.is_error === true,
              })
            }
          }
        }
      }
```

- [ ] **Step 2: Add the result-text flattener** (below `summarizeTool`)

```ts
// tool_result content is either a string or an array of blocks; flatten to text
// and cap it so a huge file/bash dump does not bloat the event buffer.
const RESULT_CAP = 4000
function toolResultText(content: unknown): string {
  let text: string
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .map((b) => (b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : ''))
      .join('')
  } else {
    text = ''
  }
  return text.length > RESULT_CAP ? `${text.slice(0, RESULT_CAP)}\n…(truncated)` : text
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck:node`
Expected: PASS. (If the SDK's `user` message content type is narrower than expected, guard with the `Array.isArray` already present; `block.type`, `block.tool_use_id`, `block.is_error`, `block.content` are standard Anthropic tool_result fields.)

- [ ] **Step 4: Commit**

```bash
git add src/main/services/chat/resumableRun.ts
git commit -m "feat(chat): emit toolId on tool_use and forward tool_result output"
```

---

### Task 4: Wire tool + tool-result into ChatHost

**Files:**
- Modify: `src/renderer/src/components/ChatHost.tsx:62-85` (onData switch)

**Interfaces:**
- Consumes: `pushTool(id, summary)`, `resolveTool(id, resultText, isError)` (Task 2); events with `toolId`/`resultText` (Tasks 2-3).

- [ ] **Step 1: Update the event type annotation and switch** (lines 62-85)

```ts
      const e = event as {
        type: string
        text?: string
        summary?: string
        message?: string
        toolId?: string
        resultText?: string
        isError?: boolean
      }
      switch (e.type) {
        case 'token':
          store.appendToken(e.text ?? '')
          break
        case 'tool':
          store.pushTool(e.toolId ?? '', e.summary ?? '')
          break
        case 'tool-result':
          store.resolveTool(e.toolId ?? '', e.resultText ?? '', e.isError === true)
          break
        case 'awaiting-input':
          store.flushTurn()
          store.setAwaiting(true)
          break
        case 'done':
          store.flushTurn()
          store.finish('done')
          break
        case 'error':
          store.finish('error')
          if (e.message) toast.error(e.message)
          break
        case 'aborted':
          store.finish('aborted')
          break
      }
```

- [ ] **Step 2: Typecheck the whole project**

Run: `pnpm typecheck`
Expected: PASS (Tasks 2-4 together make the tool plumbing type-consistent).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ChatHost.tsx
git commit -m "feat(chat): route tool + tool-result events into the run store"
```

---

### Task 5: Shared chat components (transcript, tool card, chips, composer)

**Files:**
- Create: `src/renderer/src/components/chat/ToolCallCard.tsx`
- Create: `src/renderer/src/components/chat/OptionChips.tsx`
- Create: `src/renderer/src/components/chat/ChatComposer.tsx`
- Create: `src/renderer/src/components/chat/ChatTranscript.tsx`
- Modify: `src/renderer/src/index.css` (append chat styles)

**Interfaces:**
- Consumes: `ChatEntry` (Task 2), `parseOptions` (Task 1).
- Produces:
  - `<ToolCallCard entry={toolEntry} />` where `toolEntry` is the `kind:'tool'` `ChatEntry`.
  - `<OptionChips options={string[]} onPick={(text: string) => void} />`.
  - `<ChatTranscript transcript={ChatEntry[]} streaming={string} onPickOption={(text: string) => void} />`.
  - `<ChatComposer disabled={boolean} placeholder={string} onSend={(text: string) => void} />`.

- [ ] **Step 1: ToolCallCard**

```tsx
// src/renderer/src/components/chat/ToolCallCard.tsx
import type { ChatEntry } from '@renderer/store/createChatRunStore'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useState } from 'react'

type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>

// Collapsible tool call: a loader while the tool runs, then a clickable row that
// expands to the real tool output. Replaces the old one-line `· summary` text.
export function ToolCallCard({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false)
  const hasBody = Boolean(entry.resultText)
  return (
    <div className={`chat-tool ${entry.status}`}>
      <button
        type="button"
        className="chat-tool-head"
        onClick={() => hasBody && setOpen((o) => !o)}
        disabled={!hasBody}
      >
        {entry.status === 'running' ? (
          <Loader2 size={13} className="chat-tool-spin" />
        ) : entry.status === 'error' ? (
          <X size={13} />
        ) : (
          <Check size={13} />
        )}
        <span className="chat-tool-label">{entry.text}</span>
        {hasBody ? (
          <ChevronRight size={13} className={`chat-tool-chev${open ? ' open' : ''}`} />
        ) : null}
      </button>
      {open && entry.resultText ? <pre className="chat-tool-body">{entry.resultText}</pre> : null}
    </div>
  )
}
```

- [ ] **Step 2: OptionChips**

```tsx
// src/renderer/src/components/chat/OptionChips.tsx
// Clickable choices parsed from the model's turn-ending ```options block.
export function OptionChips({
  options,
  onPick,
}: {
  options: string[]
  onPick: (text: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="chat-chips">
      {options.map((opt) => (
        <button key={opt} type="button" className="chat-chip" onClick={() => onPick(opt)}>
          {opt}
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: ChatComposer** (always-bottom input)

```tsx
// src/renderer/src/components/chat/ChatComposer.tsx
import { useState } from 'react'

// Message input, rendered as a flex-none footer so it always sits at the bottom
// of the chat body — including when the transcript is empty. Enter sends,
// Shift+Enter inserts a newline.
export function ChatComposer({
  disabled,
  placeholder,
  onSend,
}: {
  disabled: boolean
  placeholder: string
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const send = () => {
    const text = draft.trim()
    if (!text || disabled) return
    onSend(text)
    setDraft('')
  }
  return (
    <div className="chat-composer">
      <textarea
        className="input"
        rows={2}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
      />
      <button type="button" className="btn primary" disabled={disabled || !draft.trim()} onClick={send}>
        send
      </button>
    </div>
  )
}
```

- [ ] **Step 4: ChatTranscript**

```tsx
// src/renderer/src/components/chat/ChatTranscript.tsx
import type { ChatEntry } from '@renderer/store/createChatRunStore'
import { useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { OptionChips } from './OptionChips'
import { parseOptions } from './parseOptions'
import { ToolCallCard } from './ToolCallCard'

// Shared transcript renderer for every chat type: markdown for assistant/user
// text, ToolCallCard for tool entries, and option chips parsed from the last
// assistant turn. `onPickOption` sends the chosen chip text as the next reply.
export function ChatTranscript({
  transcript,
  streaming,
  onPickOption,
}: {
  transcript: ChatEntry[]
  streaming: string
  onPickOption: (text: string) => void
}) {
  const logRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  const lastAssistantIdx = transcript.map((e) => e.kind).lastIndexOf('assistant')

  return (
    <div className="chat-log" ref={logRef}>
      {transcript.map((e, i) => {
        if (e.kind === 'tool') {
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
          return <ToolCallCard key={i} entry={e} />
        }
        const isLastAssistant = e.kind === 'assistant' && i === lastAssistantIdx
        const { display, options } = isLastAssistant
          ? parseOptions(e.text)
          : { display: e.text, options: [] as string[] }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
          <div key={i} className={`chat-entry ${e.kind}`}>
            <Markdown remarkPlugins={[remarkGfm]}>{display}</Markdown>
            {isLastAssistant && !streaming ? (
              <OptionChips options={options} onPick={onPickOption} />
            ) : null}
          </div>
        )
      })}
      {streaming ? (
        <div className="chat-entry assistant">
          <Markdown remarkPlugins={[remarkGfm]}>{streaming}</Markdown>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: Append styles** to `src/renderer/src/index.css`

```css
/* Shared chat rendering (transcript, tool cards, chips, composer). The body is a
   flex column so the composer stays pinned to the bottom even when empty. */
.chat-body-flex { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.chat-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.chat-entry { font-size: 13px; line-height: 1.5; }
.chat-entry.user { opacity: 0.85; }
.chat-entry p { margin: 0 0 8px; }
.chat-entry p:last-child { margin-bottom: 0; }
.chat-entry pre { background: var(--panel-2, #1113); padding: 8px 10px; border-radius: 6px; overflow-x: auto; }
.chat-entry code { font-family: ui-monospace, monospace; font-size: 12px; }

.chat-tool { border: 1px solid var(--border, #8882); border-radius: 6px; overflow: hidden; }
.chat-tool.running { opacity: 0.85; }
.chat-tool.error { border-color: #e5484d88; }
.chat-tool-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 8px; background: transparent; border: 0; cursor: pointer; font-size: 12px; color: inherit; text-align: left; }
.chat-tool-head:disabled { cursor: default; }
.chat-tool-label { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, monospace; }
.chat-tool-chev { transition: transform 0.12s; }
.chat-tool-chev.open { transform: rotate(90deg); }
.chat-tool-spin { animation: chat-spin 0.8s linear infinite; }
@keyframes chat-spin { to { transform: rotate(360deg); } }
.chat-tool-body { margin: 0; padding: 8px 10px; max-height: 240px; overflow: auto; font-size: 11px; font-family: ui-monospace, monospace; border-top: 1px solid var(--border, #8882); white-space: pre-wrap; }

.chat-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.chat-chip { padding: 4px 10px; border: 1px solid var(--border, #8884); border-radius: 999px; background: transparent; color: inherit; font-size: 12px; cursor: pointer; }
.chat-chip:hover { border-color: var(--accent, #6c9); }

.chat-composer { flex: 0 0 auto; display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border, #8882); }
.chat-composer .input { flex: 1 1 auto; resize: none; }
```

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck:web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/chat/ src/renderer/src/index.css
git commit -m "feat(chat): shared transcript, tool card, option chips, composer + styles"
```

---

### Task 6: Adopt shared components in the four existing overlays

Each overlay swaps its inline transcript loop + footer for `<ChatTranscript>` + `<ChatComposer>` inside a `.chat-body-flex` container, and wires option-chip picks + replies to its own store/mutation. The intro (pre-start) screens stay as-is per overlay.

**Files:**
- Modify: `src/renderer/src/components/GeneralChatOverlay.tsx`
- Modify: `src/renderer/src/components/RoadmapChatOverlay.tsx`
- Modify: `src/renderer/src/components/BenchmarkChatOverlay.tsx`
- Modify: `src/renderer/src/components/SkillImproverOverlay.tsx`

**Interfaces:**
- Consumes: `ChatTranscript`, `ChatComposer` (Task 5).

- [ ] **Step 1: Rewrite `GeneralChatOverlay.tsx`** (full file)

```tsx
import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { ChatTranscript } from '@renderer/components/chat/ChatTranscript'
import { trpc } from '@renderer/lib/trpc'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useState } from 'react'

// Body of the general chat session. Reads the App-level store so the session
// survives tab switches / drawer collapse. Close/stop is owned by the drawer.
export function GeneralChatOverlay() {
  const status = useGeneralChatRun((s) => s.status)
  const sessionId = useGeneralChatRun((s) => s.sessionId)
  const transcript = useGeneralChatRun((s) => s.transcript)
  const streaming = useGeneralChatRun((s) => s.streaming)
  const awaitingInput = useGeneralChatRun((s) => s.awaitingInput)
  const startSession = useGeneralChatRun((s) => s.start)
  const pushUserReply = useGeneralChatRun((s) => s.pushUserReply)

  const reply = trpc.generalChat.reply.useMutation()
  const [draft, setDraft] = useState('')

  const started = status !== 'idle'

  const send = (text: string) => {
    if (!sessionId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ sessionId, text })
  }

  if (!started) {
    return (
      <div className="rm-chat-intro">
        <span className="rm-field-label">New chat</span>
        <textarea
          className="input"
          rows={5}
          value={draft}
          placeholder="Ask anything…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              if (draft.trim()) startSession(draft.trim())
            }
          }}
          // biome-ignore lint/a11y/noAutofocus: focus the message field when a new chat opens
          autoFocus
        />
        <div className="rm-chat-hint">
          The assistant has read-only access to this repo. ⌘↵ to start.
        </div>
        <div className="rm-chat-intro-foot">
          <button
            type="button"
            className="btn primary"
            onClick={() => draft.trim() && startSession(draft.trim())}
            disabled={!draft.trim()}
          >
            start chat
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-body-flex">
      <ChatTranscript transcript={transcript} streaming={streaming} onPickOption={send} />
      <ChatComposer
        disabled={!awaitingInput}
        placeholder={awaitingInput ? 'Reply…' : 'Assistant is thinking…'}
        onSend={send}
      />
    </div>
  )
}
```

- [ ] **Step 2: Apply the same swap to the other three overlays.** For each, keep its existing store hooks, intro screen, and any sidecar UI (roadmap "saved" banner, improver report panel, benchmark context) untouched; only replace the **started** branch's transcript loop + footer with:

```tsx
    <div className="chat-body-flex">
      <ChatTranscript transcript={transcript} streaming={streaming} onPickOption={send} />
      <ChatComposer
        disabled={!awaitingInput}
        placeholder={awaitingInput ? 'Reply…' : 'Assistant is thinking…'}
        onSend={send}
      />
    </div>
```

and define `send` in each as that overlay's existing reply path (e.g. roadmap: `pushUserReply(text); trpc.roadmapChat.reply.useMutation().mutate({ sessionId, text })`; benchmark → `trpc.benchmarkChat.reply`; improver → `trpc.skillImprover.reply`). Preserve each overlay's guard (`if (!sessionId || !awaitingInput) return`). Remove now-unused `logRef`/manual scroll effect and the old inline `.rm-chat-log`/`.rm-chat-foot` markup.

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke (dev)**

Run: `pnpm dev`. Open the general chat, send a message. Verify: markdown renders (try asking for a bulleted list), a tool call shows a spinner then a clickable card that expands to output, and the composer stays at the bottom on an empty chat.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/GeneralChatOverlay.tsx src/renderer/src/components/RoadmapChatOverlay.tsx src/renderer/src/components/BenchmarkChatOverlay.tsx src/renderer/src/components/SkillImproverOverlay.tsx
git commit -m "feat(chat): adopt shared transcript + composer in all overlays"
```

---

### Task 7: Worker chat type (store, seed, router, overlay, wiring)

**Files:**
- Modify: `src/renderer/src/store/chatDrawer.ts` (type union, titles, valid types, persist version)
- Modify: `src/renderer/src/store/chatDrawer.test.ts` / `chatDrawer.persist.test.ts` (worker cases)
- Create: `src/renderer/src/store/workerChatRun.ts`
- Create: `src/main/services/workerChat/seed.ts`
- Create: `src/main/trpc/routers/workerChat.ts`
- Modify: `src/main/trpc/router.ts` (register `workerChat`)
- Create: `src/renderer/src/components/WorkerChatOverlay.tsx`
- Modify: `src/renderer/src/App.tsx` (worker kickoff + ChatHost)

**Interfaces:**
- Consumes: `createChatRunStore` (Task 2), `startResumableChat` (Task 3), shared components (Task 5).
- Produces: `useWorkerChatRun`, `trpc.workerChat.{open,reply,cancel}`, `WorkerChatOverlay`, `'worker'` ChatSessionType.

- [ ] **Step 1: Add `worker` to the drawer store** (`chatDrawer.ts`)

```ts
export type ChatSessionType = 'benchmark' | 'roadmap' | 'skillImprover' | 'generalChat' | 'worker'
```
Add to `DEFAULT_TITLES`: `worker: 'worker'`. Add `'worker'` to `VALID_TYPES`. Bump persist `version: 1` → `version: 2` (line 108).

- [ ] **Step 2: Add a drawer test for the new type** (`chatDrawer.test.ts`)

```ts
it('opens a worker session with the default title', () => {
  useChatDrawer.getState().openSession({ type: 'worker' })
  const s = useChatDrawer.getState()
  expect(s.sessions.some((x) => x.type === 'worker' && x.title === 'worker')).toBe(true)
  expect(s.activeSessionId).toBe('worker')
})
```

Run: `pnpm exec vitest run src/renderer/src/store/chatDrawer.test.ts` → Expected: PASS.

- [ ] **Step 3: Worker run store** (`src/renderer/src/store/workerChatRun.ts`)

```ts
import { createChatRunStore } from '@renderer/store/createChatRunStore'

// Full-power worker chat run (can edit code). Persisted + resumable via the
// generic factory; the subscription is hosted at App level (ChatHost).
export const useWorkerChatRun = createChatRunStore('atlas-chat-run-worker')
```

- [ ] **Step 4: Worker seed** (`src/main/services/workerChat/seed.ts`)

```ts
// The opening user message for a worker chat session. Frames the worker as a
// full-access coding agent on the atlas-os repo and teaches the options
// convention that the renderer turns into clickable chips.
export function buildWorkerChatSeed(firstMessage: string): string {
  return [
    'You are a coding worker embedded in the atlas-os desktop app.',
    'You have full read/write access to this repository (Read, Write, Edit, Bash, Glob, Grep, Task, TodoWrite) and may modify files to complete the task.',
    'When you want the user to choose between options, end that turn with a fenced block:',
    '```options',
    'First choice',
    'Second choice',
    '```',
    'Work carefully and explain what you change. English only.',
    "The user's first message:",
    '',
    firstMessage,
  ].join('\n')
}
```

- [ ] **Step 5: Worker tRPC router** (`src/main/trpc/routers/workerChat.ts`) — clone of `generalChat.ts` with the broadened tool set and worker seed:

```ts
import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { buildWorkerChatSeed } from '@main/services/workerChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { BaseChatEvent, SeqEnvelope } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { app } from 'electron'
import { z } from 'zod'

// Full-power worker: can modify the repo (bypassPermissions at repo root).
const CHAT_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'TodoWrite']

export const workerChatRouter = router({
  open: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        lastSeq: z.number().int().nonnegative(),
        kickoff: z.string().min(1).optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<BaseChatEvent>>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const repoRoot = app.getAppPath()
        return chatRegistry.open(
          {
            sessionId: input.sessionId,
            lastSeq: input.lastSeq,
            kickoff: input.kickoff,
            resumable: true,
            buildRun: ({ resume, kickoff, push }) => {
              const job = jobRegistry.register({
                kind: 'worker.chat',
                label: 'Worker chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              })
              return startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd: repoRoot,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                seed: kickoff ? buildWorkerChatSeed(kickoff) : undefined,
                resume,
                emit: (event) => {
                  if (event.type === 'done') job.finish('done')
                  if (event.type === 'error' || event.type === 'aborted') job.finish('error')
                  push(event)
                },
              })
            },
          },
          (env) => emit.next(env as SeqEnvelope<BaseChatEvent>),
        )
      }),
    ),

  reply: publicProcedure
    .input(z.object({ sessionId: z.string().uuid(), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.reply(input.sessionId, input.text) })),

  cancel: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.cancel(input.sessionId) })),
})
```

- [ ] **Step 6: Register in the root router** (`src/main/trpc/router.ts`)

Add import near line 4: `import { workerChatRouter } from '@main/trpc/routers/workerChat'`. Add to the router map near line 39: `workerChat: workerChatRouter,`.

- [ ] **Step 7: WorkerChatOverlay** (`src/renderer/src/components/WorkerChatOverlay.tsx`) — like GeneralChatOverlay but its own store, reply mutation, and a full-access hint:

```tsx
import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { ChatTranscript } from '@renderer/components/chat/ChatTranscript'
import { trpc } from '@renderer/lib/trpc'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import { useState } from 'react'

// Body of the worker chat session — a full-access coding agent. Same shape as
// GeneralChatOverlay but with write access framed in the intro.
export function WorkerChatOverlay() {
  const status = useWorkerChatRun((s) => s.status)
  const sessionId = useWorkerChatRun((s) => s.sessionId)
  const transcript = useWorkerChatRun((s) => s.transcript)
  const streaming = useWorkerChatRun((s) => s.streaming)
  const awaitingInput = useWorkerChatRun((s) => s.awaitingInput)
  const startSession = useWorkerChatRun((s) => s.start)
  const pushUserReply = useWorkerChatRun((s) => s.pushUserReply)

  const reply = trpc.workerChat.reply.useMutation()
  const [draft, setDraft] = useState('')

  const started = status !== 'idle'

  const send = (text: string) => {
    if (!sessionId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ sessionId, text })
  }

  if (!started) {
    return (
      <div className="rm-chat-intro">
        <span className="rm-field-label">New worker</span>
        <textarea
          className="input"
          rows={5}
          value={draft}
          placeholder="Describe the change to make…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              if (draft.trim()) startSession(draft.trim())
            }
          }}
          // biome-ignore lint/a11y/noAutofocus: focus the message field when a new worker opens
          autoFocus
        />
        <div className="rm-chat-hint">
          The worker can read and modify this repo. ⌘↵ to start.
        </div>
        <div className="rm-chat-intro-foot">
          <button
            type="button"
            className="btn primary"
            onClick={() => draft.trim() && startSession(draft.trim())}
            disabled={!draft.trim()}
          >
            start worker
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-body-flex">
      <ChatTranscript transcript={transcript} streaming={streaming} onPickOption={send} />
      <ChatComposer
        disabled={!awaitingInput}
        placeholder={awaitingInput ? 'Reply…' : 'Worker is working…'}
        onSend={send}
      />
    </div>
  )
}
```

- [ ] **Step 8: Wire ChatHost + kickoff in `App.tsx`**

Add import: `import { useWorkerChatRun } from '@renderer/store/workerChatRun'`. Near line 70 add: `const workerKickoff = useWorkerChatRun((s) => s.transcript[0]?.text)`. Add a host next to the others (after the general one):

```tsx
      <ChatHost
        useRun={useWorkerChatRun}
        useOpenSubscription={trpc.workerChat.open.useSubscription}
        kickoff={workerKickoff}
      />
```

- [ ] **Step 9: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/store/chatDrawer.ts src/renderer/src/store/chatDrawer.test.ts src/renderer/src/store/workerChatRun.ts src/main/services/workerChat/seed.ts src/main/trpc/routers/workerChat.ts src/main/trpc/router.ts src/renderer/src/components/WorkerChatOverlay.tsx src/renderer/src/App.tsx
git commit -m "feat(chat): worker chat type — full-access coding agent"
```

---

### Task 8: FAB + `+` type picker; render the worker overlay

**Files:**
- Modify: `src/renderer/src/components/UnifiedChatDrawer.tsx`
- Modify: `src/renderer/src/index.css` (picker styles)

**Interfaces:**
- Consumes: `WorkerChatOverlay` (Task 7), `useWorkerChatRun`, `trpc.workerChat.cancel`.

- [ ] **Step 1: Imports + worker cancel + endSession/body wiring**

Add `import { WorkerChatOverlay } from '@renderer/components/WorkerChatOverlay'`, `import { useWorkerChatRun } from '@renderer/store/workerChatRun'`, and add `Wrench` to the lucide import. Add `const workerCancel = trpc.workerChat.cancel.useMutation()`. Extend `endSession` with a `worker` branch mirroring `generalChat`:

```ts
    } else if (type === 'worker') {
      const st = useWorkerChatRun.getState()
      if (st.sessionId && st.running) workerCancel.mutate({ sessionId: st.sessionId })
      st.reset()
    } else {
```

Add to the body switch (near line 137): `{active?.type === 'worker' ? <WorkerChatOverlay /> : null}`.

- [ ] **Step 2: Generalize the open helpers + picker state**

Replace `openGeneralChat` with a parametrized opener and add worker + picker state:

```ts
  const [pickerOpen, setPickerOpen] = useState(false)

  // Start a fresh chat of `type` unless it is actively streaming (running &&
  // !awaitingInput) — then just focus so we never interrupt an in-flight run.
  const openChat = (type: 'generalChat' | 'worker') => {
    const st = type === 'worker' ? useWorkerChatRun.getState() : useGeneralChatRun.getState()
    const cancel = type === 'worker' ? workerCancel : generalCancel
    const streamingNow = st.running && !st.awaitingInput
    if (st.status !== 'idle' && !streamingNow) {
      if (st.sessionId) cancel.mutate({ sessionId: st.sessionId })
      st.reset()
    }
    openSession({ type })
    setPickerOpen(false)
  }
```

Add `import { useState } from 'react'` (extend the existing react import).

- [ ] **Step 3: A shared two-icon picker + FAB/"+" wiring**

Add this picker element (rendered when `pickerOpen`), and point both the empty-state FAB and the `+` button at `setPickerOpen`:

```tsx
      {pickerOpen ? (
        <div className="chat-picker" role="menu">
          <button type="button" className="chat-picker-btn" onClick={() => openChat('generalChat')}>
            <MessageSquare size={16} />
            <span>Chat</span>
          </button>
          <button type="button" className="chat-picker-btn" onClick={() => openChat('worker')}>
            <Wrench size={16} />
            <span>Worker</span>
          </button>
        </div>
      ) : null}
```

FAB onClick (line 88) becomes:
```tsx
        onClick={() => (sessions.length === 0 ? setPickerOpen((o) => !o) : setOpen(true))}
```
`+` button onClick (line 120) becomes:
```tsx
            onClick={() => setPickerOpen((o) => !o)}
```

- [ ] **Step 4: Picker styles** (append to `index.css`)

```css
.chat-picker { position: fixed; right: 20px; bottom: 74px; z-index: 50; display: flex; flex-direction: column; gap: 6px; padding: 6px; background: var(--panel, #222); border: 1px solid var(--border, #8883); border-radius: 10px; box-shadow: 0 6px 20px #0006; }
.chat-picker-btn { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: transparent; border: 0; border-radius: 6px; color: inherit; font-size: 13px; cursor: pointer; }
.chat-picker-btn:hover { background: var(--panel-2, #3333); }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Manual smoke**

Run: `pnpm dev`. With no chats, click the FAB → two icons appear (Chat, Worker). Click Worker → a worker tab opens. Open the `+` picker from inside the drawer too. Give the worker a tiny task (e.g. "add a comment to README") and confirm it actually edits the file and shows tool cards.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/UnifiedChatDrawer.tsx src/renderer/src/index.css
git commit -m "feat(chat): FAB + \"+\" type picker (chat vs worker) and worker overlay"
```

---

### Task 9: e2e smoke for the type picker

**Files:**
- Modify: `e2e/app.spec.ts` (add a worker-picker case, matching the existing brand-string style)

**Interfaces:**
- Consumes: the running app (playwright drives the built app as the existing specs do).

- [ ] **Step 1: Inspect the existing spec** to match its launch/setup helpers.

Run: `sed -n '1,60p' e2e/app.spec.ts`
Expected: see how the app window is launched and how selectors/brand strings are asserted.

- [ ] **Step 2: Add a test** following that file's pattern (adapt selectors to what Step 1 shows):

```ts
test('FAB offers chat and worker, and opens a worker tab', async () => {
  // reuse the spec's existing window handle / launch helper
  await window.click('.chat-fab')
  await expect(window.locator('.chat-picker')).toBeVisible()
  await expect(window.locator('.chat-picker-btn', { hasText: 'Worker' })).toBeVisible()
  await window.click('.chat-picker-btn:has-text("Worker")')
  await expect(window.locator('.chat-tab', { hasText: 'worker' })).toBeVisible()
})
```

- [ ] **Step 3: Run e2e**

Run: `pnpm e2e`
Expected: PASS (all specs, including the new case).

- [ ] **Step 4: Commit**

```bash
git add e2e/app.spec.ts
git commit -m "test(chat): e2e — FAB type picker opens a worker tab"
```

---

## Final verification

- [ ] `pnpm lint` — no **new** errors (the pre-existing `Galaxy3D.tsx` / `d3-force-3d.d.ts` `noExplicitAny` warnings are unrelated).
- [ ] `pnpm typecheck` — PASS.
- [ ] `pnpm test` — PASS.
- [ ] `pnpm e2e` — PASS.
- [ ] Manual: worker opens from FAB and `+`, edits a real file, tool cards show loader→output, markdown renders, options render as chips and a click continues the turn, composer is bottom-pinned on an empty chat, and all four pre-existing chats still work.

## Self-review notes (coverage vs spec)

- Spec §1 shared layer → Tasks 5-6. §2 tool plumbing → Tasks 2-4. §3 options → Tasks 1, 5 (parse+render), 7 (seed convention). §4 worker type → Task 7. §5 FAB/`+` picker → Task 8. §6 testing → Tasks 1-2, 9 + manual steps. Markdown (spec cross-cutting) → Task 5 `ChatTranscript`. Sticky composer → Task 5 `.chat-body-flex`/`ChatComposer`. Persist version bump → Task 7 Step 1.
