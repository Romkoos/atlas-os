# Session Flame / Waterfall View — Design

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation plan
**Branch:** `feat/session-flame-waterfall`

## Goal

Give each Atlas OS drawer chat a real-time "flame"/waterfall (Gantt-style) view of
the underlying Claude Agent SDK run: one bar per tool call showing its duration,
subagent (`Task`) calls, and a cumulative token-burn line across the top. The same
view can **replay** a finished session by reconstructing the timeline from the
stored transcript on disk.

## Decisions (from brainstorming)

1. **Scope:** all drawer chats (worker, general, roadmap, benchmark), since they
   share the `BaseChatEvent` / `chatRegistry` event pipeline. `claude.ts`
   (`runClaude`) is out of scope — it is a pure-text, no-tools generator with
   nothing to visualize.
2. **UI placement:** a per-chat **"Transcript ⇄ Timeline" toggle** inside the
   unified chat drawer, so the waterfall sits next to the conversation.
3. **Data flow:** **live-events-primary + transcript-fallback**. While a run is
   active (or its live event buffer is non-empty), build the waterfall from
   enriched live events. When there are no live events (finished, or after an app
   restart), read the transcript. "Replay" = re-read the transcript.
4. **Event enrichment:** augment the shared `BaseChatEvent` — add optional `ts`
   (epoch ms, stamped in main) to `tool`/`tool-result`, and add a new cumulative
   `usage` event. All fields optional → backward-compatible.
5. **Rendering:** hand-rolled SVG/flex waterfall (not Recharts Gantt hacks),
   wrapped in `ChartFrame` and reusing the chart colour/format tokens for the
   amber-mono terminal look. Cumulative-token sparkline across the top.
6. **Subagents:** accept the live/replay asymmetry. Live shows a `Task` call as one
   opaque bar (labelled with `subagent_type`); replay nests the subagent's
   sidechain child tool calls one level underneath, with an expand affordance.

## Architecture

### Shared timeline model — `src/shared/timeline.ts` (new)

Both builders produce one shape so the renderer has a single code path:

```ts
export interface TimelineSpan {
  id: string            // toolId (live) or transcript-derived id
  name: string          // tool name (Read, Bash, Task, …)
  summary: string       // arg hint (reuses summarizeTool style)
  startMs: number
  endMs: number | null  // null = still running
  isError: boolean
  subagentType?: string // set on Task calls
  children?: TimelineSpan[] // sidechain rows (replay only)
  depth: number         // 0 = top level, 1 = sidechain child
}

export interface TimelinePoint {
  tMs: number
  inTokens: number   // cumulative fresh input (input + cache_creation)
  outTokens: number  // cumulative output
}

export interface SessionTimeline {
  sessionId: string
  startMs: number
  endMs: number | null
  spans: TimelineSpan[]
  tokens: TimelinePoint[]
  source: 'live' | 'transcript'
}
```

**Token convention** matches the existing `productivity/transcript.ts`: cumulative
**output** tokens plus cumulative **fresh input** (`input_tokens +
cache_creation_input_tokens`), excluding `cache_read` (which would dwarf the line).

### Event enrichment — `src/shared/ipc-events.ts` + `resumableRun.ts`

Backward-compatible additions to `BaseChatEvent`:

- `tool` gains `ts?: number`.
- `tool-result` gains `ts?: number`.
- New event: `{ type: 'usage'; ts: number; inputTokens: number; outputTokens: number }`
  — cumulative-to-date, harvested from each `assistant` message's `usage`.

In `startResumableChat` (`resumableRun.ts`):

- Inject a `now: () => number` clock (defaults to `Date.now`) for deterministic
  tests.
- On `assistant` `tool_use` → include `ts: now()` on the `tool` event.
- On `user` `tool_result` → include `ts: now()` on the `tool-result` event.
- On each `assistant` message → accumulate `outputTokens += usage.output_tokens`
  and `inputTokens += usage.input_tokens + usage.cache_creation_input_tokens`,
  then emit a `usage` event with the running totals.

These flow through `chatRegistry` → `SeqEnvelope` → renderer unchanged, so they are
buffered and replayable on reattach exactly like existing events.

### Live builder — `src/renderer/src/store/buildLiveTimeline.ts` (new, pure)

`buildLiveTimeline(events: BaseChatEvent[], now: number): SessionTimeline`

- Folds the chat's event list already held in `createChatRunStore`.
- Opens a span on each `tool` event (keyed by `toolId`, `startMs = ts`), closes it
  on the matching `tool-result` (`endMs = ts`, `isError`).
- Unmatched `tool` (no result yet) → `endMs: null` (running bar, drawn to `now`).
- `Task` tool → `subagentType` taken from the `summary`/input hint; rendered as a
  single opaque bar (no children live).
- `usage` events become the `tokens` point series.
- `source: 'live'`.

### Transcript builder — `src/main/services/timeline/` (new)

`buildTranscriptTimeline(lines: unknown[]): SessionTimeline`

- Parses `~/.claude/projects/**/<sessionId>.jsonl` (SDK transcript).
- Matches `tool_use` (assistant lines) ↔ `tool_result` (user lines) by id for
  `startMs`/`endMs` from each line's `timestamp`.
- Folds `usage` on assistant lines into cumulative `tokens` points.
- **Sidechain nesting:** `isSidechain === true` tool spans are collected and nested
  one level under the enclosing top-level `Task` span by **time containment**
  (child `startMs` within the Task's `[startMs, endMs]`). `depth = 1`.
- `source: 'transcript'`.

File location reuses the `findTranscripts`-style walk from
`productivity/ingest.ts`: glob `<sessionId>.jsonl` under `projectsDir`
(`~/.claude/projects`).

### tRPC router — `src/main/trpc/routers/timeline.ts` (new)

- `timeline.get` query: input `{ sessionId }`, output `SessionTimeline`. Reads the
  transcript file and returns `buildTranscriptTimeline(lines)`. Missing file → an
  empty timeline (`spans: []`, `tokens: []`, `endMs: null`).
- Registered in `src/main/trpc/router.ts`.

### Selection logic (renderer)

In the Timeline tab component:

- If the run is active **or** the chat's live event buffer is non-empty →
  `buildLiveTimeline(events, Date.now())`.
- Else (finished / post-restart with empty buffer) → `timeline.get({ sessionId })`
  via tRPC and render the transcript timeline.

### Renderer UI — `src/renderer/src/components/chat/SessionTimelineView.tsx` (new)

- Hand-rolled SVG/flex waterfall inside `ChartFrame`:
  - One row per `TimelineSpan`, positioned `startMs → endMs` on a shared time axis
    (`[startMs, endMs ?? now]` of the session).
  - Colour-coded by tool name using the chart colour tokens.
  - Cumulative-token sparkline across the top from `tokens`.
  - Hover tooltip: tool name, summary, duration, tokens-at-close.
  - Running spans (`endMs === null`) drawn to "now" with a distinct style.
  - Subagent (`Task`) bars: show `subagentType`; in replay, an expand affordance
    reveals indented `children` rows (`depth = 1`).
- Empty state: "No timeline yet" when there are no spans.
- **Toggle:** a "Transcript ⇄ Timeline" switch in the drawer chat header, shared
  across all four chat types via the common `ChatHost` / `UnifiedChatDrawer`.
  (Toggle state is per-chat, in-memory; not persisted across restarts.)

## Error handling

- Missing / unreadable transcript → empty timeline → "No timeline yet".
- On run `error`/`aborted`, live open spans close at the error `ts` (or `now`).
- Missing `usage` data → sparkline hidden, bars still render.
- Injected `now()` clock keeps live-builder and event-stamping deterministic in
  tests.

## Testing

- `buildLiveTimeline` unit tests: fixture event arrays (matched/unmatched tools,
  Task spans, usage series, error close) with a fixed `now`.
- `buildTranscriptTimeline` unit tests: fixture JSONL including `isSidechain`
  children, verifying nesting by time containment and token accumulation.
- `resumableRun` test: assert `ts` on `tool`/`tool-result` and cumulative `usage`
  emission using an injected `now()`.
- Transcript file-location test: given a fake projects dir, locate and parse
  `<sessionId>.jsonl`.

## Out of scope

- Enriching `claude.ts` (`runClaude`) — no tools, nothing to visualize.
- A dedicated full-page "Timeline" nav section (per-chat toggle only).
- Live reconstruction of subagent internals (accepted asymmetry).
- Persisting toggle state across app restarts.

## Files

**New**
- `src/shared/timeline.ts`
- `src/main/services/timeline/buildTranscriptTimeline.ts` (+ test)
- `src/main/services/timeline/locateTranscript.ts` (+ test)
- `src/main/trpc/routers/timeline.ts`
- `src/renderer/src/store/buildLiveTimeline.ts` (+ test)
- `src/renderer/src/components/chat/SessionTimelineView.tsx`

**Modified**
- `src/shared/ipc-events.ts` (add `ts`, `usage`)
- `src/main/services/chat/resumableRun.ts` (stamp `ts`, emit `usage`, inject `now`)
- `src/main/trpc/router.ts` (register `timeline`)
- drawer chat header / `ChatHost` (Transcript ⇄ Timeline toggle)
