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
      if (!parent.children) parent.children = []
      parent.children.push(child)
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
