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
