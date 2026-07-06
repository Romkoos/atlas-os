# Session Flame / Waterfall View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every drawer chat a per-chat "Transcript ⇄ Timeline" waterfall of the underlying Claude Agent SDK run — one bar per tool call, subagent (`Task`) bars, and a cumulative token-burn line — built from live events while running and replayed from the on-disk transcript when idle.

**Architecture:** Enrich the shared `BaseChatEvent` with per-event timestamps and a cumulative `usage` event (stamped in `resumableRun.ts`). Two pure builders produce one `SessionTimeline` shape: `buildLiveTimeline` (renderer, folds a non-persisted `timelineEvents` log kept in the chat store) and `buildTranscriptTimeline` (main, parses `~/.claude/projects/**/<sessionId>.jsonl`, exposed via a `timeline.get` tRPC query). A hand-rolled SVG/flex `SessionTimelineView` renders the waterfall inside the drawer, toggled next to `ChatTranscript`.

**Tech Stack:** Electron + tRPC + zustand + React + TypeScript; Vitest (node env, `*.test.ts` only); Biome lint; the Anthropic Claude Agent SDK.

## Global Constraints

- All UI strings and code comments in **English** only.
- Vitest runs in the **node** environment and includes **`src/**/*.test.ts` only** — no `.tsx`/DOM tests. Test pure logic (builders, store, event stamping); verify `.tsx` components via `pnpm typecheck` + `pnpm lint` + manual `pnpm dev`.
- Token convention (matches `src/main/services/productivity/transcript.ts`): cumulative **output** tokens plus cumulative **fresh input** = `input_tokens + cache_creation_input_tokens`; **exclude** `cache_read_input_tokens`.
- Event-contract additions are **optional fields** → backward-compatible; existing chats keep working untouched.
- Follow existing patterns: path aliases `@shared/*`, `@main/*`, `@renderer/*`; chart colours via CSS vars `var(--color-chart-1..5)`; panel styling via `ChartFrame`/`.panel`.
- Commit after every task. Branch: `feat/session-flame-waterfall` (already created).
- Verify a task with: `pnpm test <path>` (vitest filter), `pnpm typecheck`, `pnpm lint`.

---

### Task 1: Shared timeline model + event-contract additions

**Files:**
- Create: `src/shared/timeline.ts`
- Modify: `src/shared/ipc-events.ts:5-27` (the `BaseChatEvent` union)

**Interfaces:**
- Produces: `TimelineSpan`, `TimelinePoint`, `SessionTimeline`, `TimelineEvent` (from `@shared/timeline`); `BaseChatEvent` `tool`/`tool-result` gain optional `ts`, `tool` gains optional `subagentType`, plus a new `usage` event.

- [ ] **Step 1: Create the shared model**

Create `src/shared/timeline.ts`:

```ts
// Shared timeline model for the flame/waterfall view. Produced by two builders
// that MUST agree on this shape: buildLiveTimeline (renderer, from live events)
// and buildTranscriptTimeline (main, from the on-disk transcript).

export interface TimelineSpan {
  id: string
  name: string
  summary: string
  startMs: number
  endMs: number | null // null = still running (live)
  isError: boolean
  subagentType?: string // set on Task calls
  children?: TimelineSpan[] // sidechain rows (replay only)
  depth: number // 0 = top level, 1 = sidechain child
}

export interface TimelinePoint {
  tMs: number
  inTokens: number // cumulative fresh input (input + cache_creation)
  outTokens: number // cumulative output
}

export interface SessionTimeline {
  sessionId: string
  startMs: number
  endMs: number | null
  spans: TimelineSpan[]
  tokens: TimelinePoint[]
  source: 'live' | 'transcript'
}

// The subset of enriched chat events the live builder folds. ChatHost pushes one
// of these into the store's (non-persisted) timelineEvents log for each
// ts-bearing event it receives. `end` is synthesized renderer-side on run
// completion so open spans stop growing.
export type TimelineEvent =
  | { type: 'tool'; toolId: string; name: string; summary: string; ts: number; subagentType?: string }
  | { type: 'tool-result'; toolId: string; ts: number; isError: boolean }
  | { type: 'usage'; ts: number; inputTokens: number; outputTokens: number }
  | { type: 'end'; ts: number }
```

- [ ] **Step 2: Enrich `BaseChatEvent`**

In `src/shared/ipc-events.ts`, replace the `tool` and `tool-result` lines and add a `usage` event. Change:

```ts
  | { type: 'tool'; name: string; summary: string; toolId: string }
  | { type: 'tool-result'; toolId: string; resultText: string; isError: boolean }
```

to:

```ts
  | { type: 'tool'; name: string; summary: string; toolId: string; ts?: number; subagentType?: string }
  | { type: 'tool-result'; toolId: string; resultText: string; isError: boolean; ts?: number }
  // Cumulative-to-date token totals, harvested from each assistant message's
  // usage. Feeds the timeline's token-burn line. See docs/.../session-flame-waterfall.
  | { type: 'usage'; ts: number; inputTokens: number; outputTokens: number }
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/shared/timeline.ts src/shared/ipc-events.ts
git commit -m "feat: shared timeline model + enriched chat event contract"
```

---

### Task 2: Stamp timing + emit cumulative usage in main

**Files:**
- Modify: `src/main/services/chat/resumableRun.ts` (options interface ~19-42; message loop ~96-159)
- Test: `src/main/services/chat/resumableRun.test.ts`

**Interfaces:**
- Consumes: `BaseChatEvent` `usage`/`ts` fields (Task 1).
- Produces: `StartResumableChatOptions` gains optional `now?: () => number`; `tool`/`tool-result` events now carry `ts`, `tool` carries `subagentType` for `Task`, and a cumulative `usage` event is emitted per assistant message.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('startResumableChat', ...)` block in `src/main/services/chat/resumableRun.test.ts`. It reuses the file's existing `queryMock` + `fakeQuery` harness (already defined at the top of the file):

```ts
  it('stamps tool/tool-result ts and emits cumulative usage', async () => {
    queryMock.mockImplementation(() =>
      fakeQuery([
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } }],
            usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2 },
          },
        },
        {
          type: 'user',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false }],
          },
        },
        { type: 'result', subtype: 'success' },
      ]),
    )
    // biome-ignore lint/suspicious/noExplicitAny: collected events
    const events: any[] = []
    const run = startResumableChat({
      sessionId: 'uuid-tl',
      model: 'm',
      cwd: '/repo',
      allowedTools: ['Read'],
      settingSources: ['user'],
      env: {},
      seed: 'go',
      resume: false,
      now: () => 1000,
      emit: (e) => events.push(e),
    })
    await run.done
    const tool = events.find((e) => e.type === 'tool')
    expect(tool).toMatchObject({ toolId: 't1', name: 'Read', ts: 1000 })
    const result = events.find((e) => e.type === 'tool-result')
    expect(result).toMatchObject({ toolId: 't1', ts: 1000 })
    const usage = events.find((e) => e.type === 'usage')
    expect(usage).toMatchObject({ inputTokens: 12, outputTokens: 5, ts: 1000 })
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/chat/resumableRun.test.ts`
Expected: FAIL — no `usage` event emitted / `ts` undefined.

- [ ] **Step 3: Implement the stamping + usage**

In `src/main/services/chat/resumableRun.ts`:

Add to `StartResumableChatOptions` (after `onTurnComplete?`):

```ts
  // Injected clock so event timestamps are deterministic in tests. Defaults to Date.now.
  now?: () => number
```

Inside `startResumableChat`, near `let accumulated = ''`:

```ts
  const now = opts.now ?? Date.now
  let cumIn = 0
  let cumOut = 0
```

Replace the `assistant` branch (currently only iterates `tool_use` blocks) with one that first folds usage, then emits enriched `tool` events:

```ts
      } else if (message.type === 'assistant') {
        const usage = (message.message as { usage?: Record<string, number> }).usage
        if (usage) {
          cumOut += usage.output_tokens ?? 0
          cumIn += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
          opts.emit({ type: 'usage', ts: now(), inputTokens: cumIn, outputTokens: cumOut })
        }
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            const input = block.input as Record<string, unknown> | undefined
            opts.emit({
              type: 'tool',
              name: block.name,
              summary: summarizeTool(block),
              toolId: block.id,
              ts: now(),
              subagentType:
                block.name === 'Task' && typeof input?.subagent_type === 'string'
                  ? (input.subagent_type as string)
                  : undefined,
            })
          }
        }
      }
```

In the `user`/`tool_result` branch, add `ts: now(),` to the emitted `tool-result` object.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/chat/resumableRun.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm typecheck`
Then:

```bash
git add src/main/services/chat/resumableRun.ts src/main/services/chat/resumableRun.test.ts
git commit -m "feat: stamp tool ts + emit cumulative usage in resumable chat run"
```

---

### Task 3: Live timeline builder (renderer, pure)

**Files:**
- Create: `src/renderer/src/store/buildLiveTimeline.ts`
- Test: `src/renderer/src/store/buildLiveTimeline.test.ts`

**Interfaces:**
- Consumes: `TimelineEvent`, `SessionTimeline` (Task 1).
- Produces: `buildLiveTimeline(sessionId: string, events: TimelineEvent[], now: number): SessionTimeline`.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/store/buildLiveTimeline.test.ts`:

```ts
import type { TimelineEvent } from '@shared/timeline'
import { describe, expect, it } from 'vitest'
import { buildLiveTimeline } from './buildLiveTimeline'

describe('buildLiveTimeline', () => {
  it('pairs tool + tool-result into a closed span', () => {
    const events: TimelineEvent[] = [
      { type: 'tool', toolId: 't1', name: 'Read', summary: 'Read: a.ts', ts: 100 },
      { type: 'tool-result', toolId: 't1', ts: 250, isError: false },
    ]
    const tl = buildLiveTimeline('s', events, 999)
    expect(tl.spans).toHaveLength(1)
    expect(tl.spans[0]).toMatchObject({ id: 't1', startMs: 100, endMs: 250, isError: false, depth: 0 })
    expect(tl.startMs).toBe(100)
    expect(tl.source).toBe('live')
  })

  it('leaves an unresolved tool open (endMs null) while running', () => {
    const events: TimelineEvent[] = [{ type: 'tool', toolId: 't1', name: 'Bash', summary: 'Bash', ts: 100 }]
    const tl = buildLiveTimeline('s', events, 500)
    expect(tl.spans[0].endMs).toBeNull()
    expect(tl.endMs).toBeNull()
  })

  it('closes open spans at the end event when the run finished', () => {
    const events: TimelineEvent[] = [
      { type: 'tool', toolId: 't1', name: 'Bash', summary: 'Bash', ts: 100 },
      { type: 'end', ts: 400 },
    ]
    const tl = buildLiveTimeline('s', events, 999)
    expect(tl.spans[0].endMs).toBe(400)
    expect(tl.endMs).toBe(400)
  })

  it('carries subagentType and builds the cumulative token series', () => {
    const events: TimelineEvent[] = [
      { type: 'tool', toolId: 't1', name: 'Task', summary: 'Task: Explore', ts: 100, subagentType: 'Explore' },
      { type: 'usage', ts: 120, inputTokens: 10, outputTokens: 3 },
      { type: 'usage', ts: 200, inputTokens: 25, outputTokens: 9 },
    ]
    const tl = buildLiveTimeline('s', events, 999)
    expect(tl.spans[0].subagentType).toBe('Explore')
    expect(tl.tokens).toEqual([
      { tMs: 120, inTokens: 10, outTokens: 3 },
      { tMs: 200, inTokens: 25, outTokens: 9 },
    ])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/src/store/buildLiveTimeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `src/renderer/src/store/buildLiveTimeline.ts`:

```ts
import type { SessionTimeline, TimelineEvent, TimelinePoint, TimelineSpan } from '@shared/timeline'

// Folds the store's non-persisted timelineEvents log into a SessionTimeline.
// While a run is live, unresolved tool spans stay open (endMs null) so the view
// draws them to "now"; once an `end` event arrives they close at that instant.
export function buildLiveTimeline(
  sessionId: string,
  events: TimelineEvent[],
  now: number,
): SessionTimeline {
  const spans: TimelineSpan[] = []
  const byId = new Map<string, TimelineSpan>()
  const tokens: TimelinePoint[] = []
  let endMs: number | null = null

  for (const ev of events) {
    if (ev.type === 'tool') {
      const span: TimelineSpan = {
        id: ev.toolId,
        name: ev.name,
        summary: ev.summary,
        startMs: ev.ts,
        endMs: null,
        isError: false,
        subagentType: ev.subagentType,
        depth: 0,
      }
      byId.set(ev.toolId, span)
      spans.push(span)
    } else if (ev.type === 'tool-result') {
      const span = byId.get(ev.toolId)
      if (span) {
        span.endMs = ev.ts
        span.isError = ev.isError
      }
    } else if (ev.type === 'usage') {
      tokens.push({ tMs: ev.ts, inTokens: ev.inputTokens, outTokens: ev.outputTokens })
    } else if (ev.type === 'end') {
      endMs = ev.ts
    }
  }

  // A finished run must not leave bars growing forever: close still-open spans at
  // the end instant. A live run keeps them open (drawn to `now` by the view).
  if (endMs !== null) {
    for (const span of spans) if (span.endMs === null) span.endMs = endMs
  }

  const startCandidates = spans.map((s) => s.startMs)
  const startMs = startCandidates.length ? Math.min(...startCandidates) : (tokens[0]?.tMs ?? now)

  return { sessionId, startMs, endMs, spans, tokens, source: 'live' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/renderer/src/store/buildLiveTimeline.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/store/buildLiveTimeline.ts src/renderer/src/store/buildLiveTimeline.test.ts
git commit -m "feat: live timeline builder from enriched chat events"
```

---

### Task 4: Transcript timeline builder (main, pure)

**Files:**
- Create: `src/main/services/timeline/buildTranscriptTimeline.ts`
- Test: `src/main/services/timeline/buildTranscriptTimeline.test.ts`

**Interfaces:**
- Consumes: `SessionTimeline`, `TimelineSpan`, `TimelinePoint` (Task 1).
- Produces: `buildTranscriptTimeline(sessionId: string, lines: unknown[]): SessionTimeline`.

- [ ] **Step 1: Write the failing test**

Create `src/main/services/timeline/buildTranscriptTimeline.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildTranscriptTimeline } from './buildTranscriptTimeline'

// Minimal transcript-line factories mirroring ~/.claude/projects/**/*.jsonl.
const asst = (ts: string, blocks: unknown[], usage?: Record<string, number>, sidechain = false) => ({
  type: 'assistant',
  timestamp: ts,
  isSidechain: sidechain,
  message: { content: blocks, usage },
})
const userResult = (ts: string, id: string, isError = false, sidechain = false) => ({
  type: 'user',
  timestamp: ts,
  isSidechain: sidechain,
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] },
})
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
})

describe('buildTranscriptTimeline', () => {
  it('pairs tool_use with tool_result by id and accumulates tokens', () => {
    const lines = [
      asst('2026-07-06T00:00:00.100Z', [toolUse('t1', 'Read', { file_path: 'a.ts' })], {
        input_tokens: 10,
        output_tokens: 4,
        cache_creation_input_tokens: 2,
      }),
      userResult('2026-07-06T00:00:00.300Z', 't1'),
    ]
    const tl = buildTranscriptTimeline('s', lines)
    expect(tl.source).toBe('transcript')
    expect(tl.spans).toHaveLength(1)
    expect(tl.spans[0]).toMatchObject({ id: 't1', name: 'Read', isError: false, depth: 0 })
    expect(tl.spans[0].endMs).toBeGreaterThan(tl.spans[0].startMs)
    expect(tl.tokens).toEqual([{ tMs: Date.parse('2026-07-06T00:00:00.100Z'), inTokens: 12, outTokens: 4 }])
  })

  it('nests sidechain tool spans under the enclosing Task by time containment', () => {
    const lines = [
      asst('2026-07-06T00:00:01.000Z', [toolUse('task1', 'Task', { subagent_type: 'Explore' })]),
      // sidechain child runs inside the Task window:
      asst('2026-07-06T00:00:01.200Z', [toolUse('c1', 'Grep', { pattern: 'foo' })], undefined, true),
      userResult('2026-07-06T00:00:01.400Z', 'c1', false, true),
      userResult('2026-07-06T00:00:02.000Z', 'task1'),
    ]
    const tl = buildTranscriptTimeline('s', lines)
    const top = tl.spans.filter((s) => s.depth === 0)
    expect(top).toHaveLength(1)
    expect(top[0]).toMatchObject({ id: 'task1', subagentType: 'Explore' })
    expect(top[0].children).toHaveLength(1)
    expect(top[0].children?.[0]).toMatchObject({ id: 'c1', name: 'Grep', depth: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/timeline/buildTranscriptTimeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builder**

Create `src/main/services/timeline/buildTranscriptTimeline.ts`:

```ts
import type { SessionTimeline, TimelinePoint, TimelineSpan } from '@shared/timeline'

interface RawLine {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { content?: unknown; usage?: Record<string, number> }
}

interface ToolUseBlock {
  type?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
}
interface ToolResultBlock {
  type?: string
  tool_use_id?: string
  is_error?: boolean
}

// Short arg hint for a tool call — mirrors resumableRun's summarizeTool so live
// and replay labels read alike.
function summarize(name: string, input?: Record<string, unknown>): string {
  if (!input) return name
  const hint =
    (typeof input.skill === 'string' && input.skill) ||
    (typeof input.subagent_type === 'string' && input.subagent_type) ||
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.pattern === 'string' && input.pattern) ||
    (typeof input.command === 'string' && input.command) ||
    (typeof input.description === 'string' && input.description) ||
    ''
  const text = String(hint).slice(0, 80)
  return text ? `${name}: ${text}` : name
}

function ms(ts?: string): number {
  const n = ts ? Date.parse(ts) : Number.NaN
  return Number.isNaN(n) ? 0 : n
}

// Parses Claude Code transcript lines into a SessionTimeline. tool_use↔tool_result
// are matched by id for start/end; assistant usage folds into a cumulative token
// series; isSidechain tool spans nest one level under the enclosing top-level Task
// span (child start within [task.start, task.end]).
export function buildTranscriptTimeline(sessionId: string, lines: unknown[]): SessionTimeline {
  const byId = new Map<string, TimelineSpan>()
  const topSpans: TimelineSpan[] = []
  const sideSpans: TimelineSpan[] = []
  const tokens: TimelinePoint[] = []
  let cumIn = 0
  let cumOut = 0

  for (const raw of lines) {
    const line = raw as RawLine
    const tMs = ms(line.timestamp)
    const sidechain = line.isSidechain === true

    if (line.type === 'assistant') {
      const u = line.message?.usage
      if (u) {
        cumIn += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        cumOut += u.output_tokens ?? 0
        tokens.push({ tMs, inTokens: cumIn, outTokens: cumOut })
      }
      const content = line.message?.content
      if (Array.isArray(content)) {
        for (const b of content as ToolUseBlock[]) {
          if (b?.type !== 'tool_use' || !b.id || !b.name) continue
          const span: TimelineSpan = {
            id: b.id,
            name: b.name,
            summary: summarize(b.name, b.input),
            startMs: tMs,
            endMs: null,
            isError: false,
            subagentType:
              b.name === 'Task' && typeof b.input?.subagent_type === 'string'
                ? (b.input.subagent_type as string)
                : undefined,
            depth: sidechain ? 1 : 0,
          }
          byId.set(b.id, span)
          if (sidechain) sideSpans.push(span)
          else topSpans.push(span)
        }
      }
    } else if (line.type === 'user') {
      const content = line.message?.content
      if (Array.isArray(content)) {
        for (const b of content as ToolResultBlock[]) {
          if (b?.type !== 'tool_result' || !b.tool_use_id) continue
          const span = byId.get(b.tool_use_id)
          if (span) {
            span.endMs = tMs
            span.isError = b.is_error === true
          }
        }
      }
    }
  }

  // Nest each sidechain span under the top-level Task span whose window contains
  // its start. Unmatched sidechain spans fall back to top level.
  const taskSpans = topSpans.filter((s) => s.name === 'Task')
  for (const child of sideSpans) {
    const parent = taskSpans.find(
      (t) => child.startMs >= t.startMs && child.startMs <= (t.endMs ?? Number.POSITIVE_INFINITY),
    )
    if (parent) {
      ;(parent.children ??= []).push(child)
    } else {
      child.depth = 0
      topSpans.push(child)
    }
  }

  const starts = topSpans.map((s) => s.startMs)
  const ends = topSpans.map((s) => s.endMs).filter((e): e is number => e !== null)
  return {
    sessionId,
    startMs: starts.length ? Math.min(...starts) : 0,
    endMs: ends.length ? Math.max(...ends) : null,
    spans: topSpans,
    tokens,
    source: 'transcript',
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/main/services/timeline/buildTranscriptTimeline.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/timeline/buildTranscriptTimeline.ts src/main/services/timeline/buildTranscriptTimeline.test.ts
git commit -m "feat: transcript timeline builder with sidechain nesting"
```

---

### Task 5: Transcript locator + `timeline` tRPC router

**Files:**
- Create: `src/main/services/timeline/locateTranscript.ts`
- Test: `src/main/services/timeline/locateTranscript.test.ts`
- Create: `src/main/trpc/routers/timeline.ts`
- Modify: `src/main/trpc/router.ts` (imports ~1-20; router map ~22-42)

**Interfaces:**
- Consumes: `buildTranscriptTimeline` (Task 4), `readJsonlFile` (`@main/services/productivity/jsonl`), `appPaths` (`@main/paths`).
- Produces: `locateTranscript(projectsDir: string, sessionId: string): Promise<string | null>`; `timelineRouter` with `get({ sessionId }) → SessionTimeline`; registered as `timeline` in `appRouter`.

- [ ] **Step 1: Write the failing test for the locator**

Create `src/main/services/timeline/locateTranscript.test.ts`:

```ts
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { locateTranscript } from './locateTranscript'

describe('locateTranscript', () => {
  const dirs: string[] = []
  afterAll(() => {}) // tmp dirs are OS-cleaned

  it('finds <sessionId>.jsonl nested under a project dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tl-'))
    dirs.push(root)
    await mkdir(join(root, 'proj-a'), { recursive: true })
    await writeFile(join(root, 'proj-a', 'abc.jsonl'), '{}\n', 'utf8')
    expect(await locateTranscript(root, 'abc')).toBe(join(root, 'proj-a', 'abc.jsonl'))
  })

  it('returns null when absent or when the dir is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tl-'))
    dirs.push(root)
    expect(await locateTranscript(root, 'nope')).toBeNull()
    expect(await locateTranscript(join(root, 'ghost'), 'x')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/main/services/timeline/locateTranscript.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the locator**

Create `src/main/services/timeline/locateTranscript.ts`:

```ts
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

// Finds the SDK transcript file for a session: ~/.claude/projects encodes cwd as
// one subdir per project, each holding <sessionId>.jsonl. Returns the first match
// or null (missing dir / no such session).
export async function locateTranscript(
  projectsDir: string,
  sessionId: string,
): Promise<string | null> {
  const target = `${sessionId}.jsonl`
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === target) return join(projectsDir, entry.name)
    if (entry.isDirectory()) {
      const inner = join(projectsDir, entry.name)
      let files: string[]
      try {
        files = await readdir(inner)
      } catch {
        continue
      }
      if (files.includes(target)) return join(inner, target)
    }
  }
  return null
}
```

- [ ] **Step 4: Run locator test to verify it passes**

Run: `pnpm test src/main/services/timeline/locateTranscript.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the router**

Create `src/main/trpc/routers/timeline.ts`:

```ts
import { appPaths } from '@main/paths'
import { readJsonlFile } from '@main/services/productivity/jsonl'
import { buildTranscriptTimeline } from '@main/services/timeline/buildTranscriptTimeline'
import { locateTranscript } from '@main/services/timeline/locateTranscript'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { SessionTimeline } from '@shared/timeline'
import { z } from 'zod'

export const timelineRouter = router({
  // Replay: reconstruct a finished session's timeline from its on-disk transcript.
  get: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }): Promise<SessionTimeline> => {
      const file = await locateTranscript(appPaths().claudeProjectsDir, input.sessionId)
      if (!file) {
        return { sessionId: input.sessionId, startMs: 0, endMs: null, spans: [], tokens: [], source: 'transcript' }
      }
      const lines = await readJsonlFile(file)
      return buildTranscriptTimeline(input.sessionId, lines)
    }),
})
```

- [ ] **Step 6: Register the router**

In `src/main/trpc/router.ts`, add the import (alphabetical, after `subscriptionUsage`):

```ts
import { timelineRouter } from '@main/trpc/routers/timeline'
```

And add to the `router({ ... })` map:

```ts
  timeline: timelineRouter,
```

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm typecheck`
Then:

```bash
git add src/main/services/timeline/locateTranscript.ts src/main/services/timeline/locateTranscript.test.ts src/main/trpc/routers/timeline.ts src/main/trpc/router.ts
git commit -m "feat: transcript locator + timeline.get tRPC query"
```

---

### Task 6: Store timeline slice + ChatHost dispatch

**Files:**
- Modify: `src/renderer/src/store/createChatRunStore.ts` (state interface ~25-51; initial/start/startBlank/reset; new method)
- Modify: `src/renderer/src/components/ChatHost.tsx` (event cast ~81-90; switch ~91-130)
- Test: `src/renderer/src/store/createChatRunStore.test.ts`

**Interfaces:**
- Consumes: `TimelineEvent` (Task 1).
- Produces: `BaseChatRunState` gains `timelineEvents: TimelineEvent[]` (non-persisted) + `pushTimelineEvent(ev: TimelineEvent): void`; ChatHost forwards `tool`/`tool-result`/`usage`/`end` into it.

- [ ] **Step 1: Write the failing test**

Add to `src/renderer/src/store/createChatRunStore.test.ts`:

```ts
it('accumulates timelineEvents and clears them on reset/start', () => {
  const useRun = createChatRunStore('test-timeline')
  useRun.getState().start('hi')
  expect(useRun.getState().timelineEvents).toEqual([])
  useRun.getState().pushTimelineEvent({ type: 'tool', toolId: 't1', name: 'Read', summary: 'Read', ts: 1 })
  expect(useRun.getState().timelineEvents).toHaveLength(1)
  useRun.getState().reset()
  expect(useRun.getState().timelineEvents).toEqual([])
})
```

(Match the existing import style at the top of the test file: `import { createChatRunStore } from './createChatRunStore'`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/renderer/src/store/createChatRunStore.test.ts`
Expected: FAIL — `timelineEvents`/`pushTimelineEvent` do not exist.

- [ ] **Step 3: Add the store slice**

In `src/renderer/src/store/createChatRunStore.ts`:

Add the import at the top:

```ts
import type { TimelineEvent } from '@shared/timeline'
```

In `BaseChatRunState`, after `lastSeq: number`:

```ts
  // Non-persisted log of enriched timeline events for the live waterfall. Not
  // persisted: after an app restart it is empty, so the Timeline tab falls back
  // to the on-disk transcript (replay).
  timelineEvents: TimelineEvent[]
```

And in the methods block of the interface, after `bumpSeq`:

```ts
  pushTimelineEvent: (ev: TimelineEvent) => void
```

In the store body, add `timelineEvents: [],` to the initial state, to the object returned by `start`, and by `startBlank`, and by `reset` (i.e. wherever `lastSeq: 0` is set at those four sites).

Add the method (after `bumpSeq`):

```ts
        pushTimelineEvent: (ev) => set((s) => ({ timelineEvents: [...s.timelineEvents, ev] })),
```

Leave `partialize` unchanged — `timelineEvents` is deliberately NOT persisted.

- [ ] **Step 4: Run store test to verify it passes**

Run: `pnpm test src/renderer/src/store/createChatRunStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Forward events in ChatHost**

In `src/renderer/src/components/ChatHost.tsx`, extend the event cast (`const e = event as {...}`) with the new fields:

```ts
      const e = event as {
        type: string
        text?: string
        name?: string
        summary?: string
        message?: string
        toolId?: string
        resultText?: string
        isError?: boolean
        ts?: number
        subagentType?: string
        inputTokens?: number
        outputTokens?: number
      }
```

In the `switch (e.type)`, update `tool`, `tool-result`, add `usage`, and append an `end` push to `done`/`error`/`aborted`:

```ts
        case 'tool':
          store.pushTool(e.toolId ?? '', e.name ?? '', e.summary ?? '')
          store.pushTimelineEvent({
            type: 'tool',
            toolId: e.toolId ?? '',
            name: e.name ?? '',
            summary: e.summary ?? '',
            ts: e.ts ?? Date.now(),
            subagentType: e.subagentType,
          })
          break
        case 'tool-result':
          store.resolveTool(e.toolId ?? '', e.resultText ?? '', e.isError === true)
          store.pushTimelineEvent({
            type: 'tool-result',
            toolId: e.toolId ?? '',
            ts: e.ts ?? Date.now(),
            isError: e.isError === true,
          })
          break
        case 'usage':
          store.pushTimelineEvent({
            type: 'usage',
            ts: e.ts ?? Date.now(),
            inputTokens: e.inputTokens ?? 0,
            outputTokens: e.outputTokens ?? 0,
          })
          break
```

And in the existing `done`, `error`, and `aborted` cases, add as the first line of each:

```ts
          store.pushTimelineEvent({ type: 'end', ts: Date.now() })
```

- [ ] **Step 6: Typecheck + lint + commit**

Run: `pnpm typecheck && pnpm lint`
Then:

```bash
git add src/renderer/src/store/createChatRunStore.ts src/renderer/src/store/createChatRunStore.test.ts src/renderer/src/components/ChatHost.tsx
git commit -m "feat: chat store timeline slice + ChatHost event forwarding"
```

---

### Task 7: Waterfall view + drawer toggle + overlay wiring

**Files:**
- Create: `src/renderer/src/components/chat/SessionTimelineView.tsx`
- Create: `src/renderer/src/components/chat/TimelineChatBody.tsx`
- Modify: `src/renderer/src/components/WorkerChatOverlay.tsx`
- Modify: `src/renderer/src/components/GeneralChatOverlay.tsx`
- Modify: `src/renderer/src/components/RoadmapChatOverlay.tsx`
- Modify: `src/renderer/src/components/BenchmarkChatOverlay.tsx`
- Modify: `src/renderer/src/index.css` (append a styles block)

**Interfaces:**
- Consumes: `buildLiveTimeline` (Task 3), `trpc.timeline.get` (Task 5), store `timelineEvents`/`running` (Task 6), `SessionTimeline`/`TimelineSpan` (Task 1).
- Produces: `SessionTimelineView({ sessionId, timelineEvents, running })`; `TimelineChatBody({ sessionId, transcript, streaming, awaitingInput, timelineEvents, running, onPickOption })`.

> Verification for this task is `pnpm typecheck` + `pnpm lint` + manual `pnpm dev` (no DOM test env). Do NOT write a `.tsx` test.

- [ ] **Step 1: Create the waterfall view**

Create `src/renderer/src/components/chat/SessionTimelineView.tsx`:

```tsx
import { buildLiveTimeline } from '@renderer/store/buildLiveTimeline'
import { trpc } from '@renderer/lib/trpc'
import type { SessionTimeline, TimelineEvent, TimelineSpan } from '@shared/timeline'
import { useEffect, useMemo, useState } from 'react'

const CHART_VARS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

// Stable colour per tool name (hash → one of the 5 chart vars).
function colorFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return CHART_VARS[Math.abs(h) % CHART_VARS.length]
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

// One waterfall row; recurses one level for subagent children (replay).
function SpanRow({ span, minMs, spanMs }: { span: TimelineSpan; minMs: number; spanMs: number }) {
  const end = span.endMs ?? minMs + spanMs
  const left = ((span.startMs - minMs) / spanMs) * 100
  const width = Math.max(0.5, ((end - span.startMs) / spanMs) * 100)
  const dur = (span.endMs ?? end) - span.startMs
  return (
    <>
      <div className={`tl-row${span.depth ? ' tl-row-child' : ''}`}>
        <div className="tl-label" title={span.summary}>
          {span.subagentType ? `⤷ ${span.subagentType}` : span.name}
        </div>
        <div className="tl-track">
          <div
            className={`tl-bar${span.isError ? ' tl-bar-error' : ''}${span.endMs === null ? ' tl-bar-running' : ''}`}
            style={{ left: `${left}%`, width: `${width}%`, background: colorFor(span.name) }}
            title={`${span.summary} · ${fmtDur(dur)}${span.endMs === null ? ' · running' : ''}`}
          />
        </div>
      </div>
      {span.children?.map((c) => (
        <SpanRow key={c.id} span={c} minMs={minMs} spanMs={spanMs} />
      ))}
    </>
  )
}

// Thin cumulative-output-token sparkline across the same time domain.
function TokenSparkline({ tl, minMs, spanMs }: { tl: SessionTimeline; minMs: number; spanMs: number }) {
  if (tl.tokens.length < 2) return null
  const maxOut = Math.max(...tl.tokens.map((t) => t.outTokens), 1)
  const pts = tl.tokens
    .map((t) => `${((t.tMs - minMs) / spanMs) * 100},${100 - (t.outTokens / maxOut) * 100}`)
    .join(' ')
  const total = tl.tokens[tl.tokens.length - 1].outTokens
  return (
    <div className="tl-spark">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Cumulative output tokens">
        <polyline points={pts} fill="none" stroke="var(--color-chart-1)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="tl-spark-cap">{total.toLocaleString()} out tok</span>
    </div>
  )
}

export function SessionTimelineView({
  sessionId,
  timelineEvents,
  running,
}: {
  sessionId: string
  timelineEvents: TimelineEvent[]
  running: boolean
}) {
  // Re-render clock so running bars grow smoothly.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNowTick(Date.now()), 500)
    return () => clearInterval(id)
  }, [running])

  const hasLive = timelineEvents.length > 0
  // Replay: only fetch the transcript when there is no live data for this session.
  const query = trpc.timeline.get.useQuery({ sessionId }, { enabled: !hasLive && sessionId.length > 0 })

  const timeline: SessionTimeline | null = useMemo(() => {
    if (hasLive) return buildLiveTimeline(sessionId, timelineEvents, nowTick)
    return query.data ?? null
  }, [hasLive, sessionId, timelineEvents, nowTick, query.data])

  if (!timeline || timeline.spans.length === 0) {
    return <div className="tl-empty">{query.isLoading ? 'Loading timeline…' : 'No timeline yet'}</div>
  }

  const minMs = timeline.startMs
  const spanMs = Math.max(1, (timeline.endMs ?? nowTick) - minMs)

  return (
    <div className="tl-wrap">
      <TokenSparkline tl={timeline} minMs={minMs} spanMs={spanMs} />
      <div className="tl-rows">
        {timeline.spans.map((s) => (
          <SpanRow key={s.id} span={s} minMs={minMs} spanMs={spanMs} />
        ))}
      </div>
      <div className="tl-axis">
        <span>0s</span>
        <span>{fmtDur(spanMs)}</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the toggle wrapper**

Create `src/renderer/src/components/chat/TimelineChatBody.tsx`:

```tsx
import { ChatTranscript } from '@renderer/components/chat/ChatTranscript'
import { SessionTimelineView } from '@renderer/components/chat/SessionTimelineView'
import type { ChatEntry } from '@renderer/store/createChatRunStore'
import type { TimelineEvent } from '@shared/timeline'
import { useState } from 'react'

// Drop-in replacement for <ChatTranscript> inside a drawer chat body: adds a
// per-chat "Transcript ⇄ Timeline" toggle. Toggle state is in-memory (resets on
// restart) — intentional, matches the design.
export function TimelineChatBody({
  sessionId,
  transcript,
  streaming,
  awaitingInput,
  timelineEvents,
  running,
  onPickOption,
}: {
  sessionId: string | null
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  timelineEvents: TimelineEvent[]
  running: boolean
  onPickOption: (text: string) => void
}) {
  const [view, setView] = useState<'transcript' | 'timeline'>('transcript')
  return (
    <div className="chat-view-wrap">
      <div className="chat-view-toggle" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'transcript'}
          className={view === 'transcript' ? 'active' : ''}
          onClick={() => setView('transcript')}
        >
          Transcript
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'timeline'}
          className={view === 'timeline' ? 'active' : ''}
          onClick={() => setView('timeline')}
        >
          Timeline
        </button>
      </div>
      {view === 'transcript' ? (
        <ChatTranscript
          transcript={transcript}
          streaming={streaming}
          awaitingInput={awaitingInput}
          onPickOption={onPickOption}
        />
      ) : (
        <SessionTimelineView
          sessionId={sessionId ?? ''}
          timelineEvents={timelineEvents}
          running={running}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Wire the four overlays**

In **each** of the four overlays, (a) add store selectors for `timelineEvents` and `running`, (b) swap the `<ChatTranscript .../>` element for `<TimelineChatBody .../>`, and (c) replace the `ChatTranscript` import with `TimelineChatBody`.

`WorkerChatOverlay.tsx` — replace the import line:
```tsx
import { ChatTranscript } from '@renderer/components/chat/ChatTranscript'
```
with:
```tsx
import { TimelineChatBody } from '@renderer/components/chat/TimelineChatBody'
```
Add selectors after `const pushUserReply = useWorkerChatRun((s) => s.pushUserReply)`:
```tsx
  const timelineEvents = useWorkerChatRun((s) => s.timelineEvents)
  const running = useWorkerChatRun((s) => s.running)
```
Replace the `<ChatTranscript ... />` block with:
```tsx
      <TimelineChatBody
        sessionId={sessionId}
        transcript={transcript}
        streaming={streaming}
        awaitingInput={awaitingInput}
        timelineEvents={timelineEvents}
        running={running}
        onPickOption={send}
      />
```

`GeneralChatOverlay.tsx` — same three edits using `useGeneralChatRun`.

`BenchmarkChatOverlay.tsx` — same three edits using `useBenchmarkChatRun`.

`RoadmapChatOverlay.tsx` — same three edits using `useRoadmapChatRun`; keep the existing `{savedItem ? (...) : null}` block exactly where it is (immediately after the new `<TimelineChatBody .../>`).

- [ ] **Step 4: Append styles**

Append to `src/renderer/src/index.css`:

```css
/* ── Session timeline (flame/waterfall) ─────────────────────────────── */
.chat-view-wrap { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.chat-view-toggle { display: flex; gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--color-border); }
.chat-view-toggle button {
  font: inherit; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
  padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 4px;
  background: transparent; color: var(--color-muted-foreground); cursor: pointer;
}
.chat-view-toggle button.active { color: var(--color-chart-1); border-color: var(--color-chart-1); }
.tl-wrap { flex: 1; overflow: auto; padding: 10px 12px; font-size: 11px; }
.tl-empty { flex: 1; display: grid; place-items: center; color: var(--color-muted-foreground); font-size: 12px; }
.tl-spark { position: relative; height: 40px; margin-bottom: 8px; border-bottom: 1px dashed var(--color-border); }
.tl-spark svg { width: 100%; height: 100%; display: block; }
.tl-spark-cap { position: absolute; top: 2px; right: 2px; color: var(--color-muted-foreground); font-size: 10px; }
.tl-rows { display: flex; flex-direction: column; gap: 3px; }
.tl-row { display: grid; grid-template-columns: 120px 1fr; align-items: center; gap: 8px; }
.tl-row-child .tl-label { padding-left: 12px; opacity: 0.8; }
.tl-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--color-muted-foreground); }
.tl-track { position: relative; height: 14px; background: color-mix(in srgb, var(--color-border) 40%, transparent); border-radius: 3px; }
.tl-bar { position: absolute; top: 0; height: 100%; border-radius: 3px; min-width: 2px; }
.tl-bar-running { opacity: 0.55; animation: tl-pulse 1s ease-in-out infinite; }
.tl-bar-error { outline: 1px solid var(--color-destructive); }
.tl-axis { display: flex; justify-content: space-between; margin-top: 6px; color: var(--color-muted-foreground); font-size: 10px; }
@keyframes tl-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 0.85; } }
```

(All referenced vars — `--color-border`, `--color-muted-foreground`, `--color-destructive`, `--color-chart-1..5` — are already defined in `index.css`.)

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS (0 errors; pre-existing Galaxy3D/d3-force-3d warnings are unrelated).

- [ ] **Step 6: Manual verification in dev**

Run: `pnpm dev`. Open a Worker chat, ask it to do something with a couple of tool calls (e.g. "read package.json then list src/"). Switch the drawer toggle to **Timeline**: confirm bars appear with durations, running bars pulse, and the token sparkline grows. Let it finish, then close+reopen the drawer tab or restart the app and confirm the **Timeline** tab replays from the transcript (bars still present, `source` transcript path). Repeat a quick smoke check on a General chat.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/chat/SessionTimelineView.tsx src/renderer/src/components/chat/TimelineChatBody.tsx src/renderer/src/components/WorkerChatOverlay.tsx src/renderer/src/components/GeneralChatOverlay.tsx src/renderer/src/components/RoadmapChatOverlay.tsx src/renderer/src/components/BenchmarkChatOverlay.tsx src/renderer/src/index.css
git commit -m "feat: session flame/waterfall view with Transcript/Timeline toggle"
```

---

## Final verification

- [ ] Run the full suite: `pnpm test` — all green.
- [ ] `pnpm typecheck && pnpm lint` — clean (bar the pre-existing Galaxy3D warnings).
- [ ] Manual dev smoke per Task 7 Step 6 (live + replay, at least two chat types).

## Task dependency order

1 → 2, 3, 4, 6 (all depend only on 1) → 5 (depends on 4) → 7 (depends on 3, 5, 6). Execute 1, 2, 3, 4, 5, 6, 7 in order.
