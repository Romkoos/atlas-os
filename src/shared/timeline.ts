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
  | {
      type: 'tool'
      toolId: string
      name: string
      summary: string
      ts: number
      subagentType?: string
    }
  | { type: 'tool-result'; toolId: string; ts: number; isError: boolean }
  | { type: 'usage'; ts: number; inputTokens: number; outputTokens: number }
  | { type: 'end'; ts: number }
