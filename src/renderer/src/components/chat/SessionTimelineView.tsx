import { trpc } from '@renderer/lib/trpc'
import { buildLiveTimeline } from '@renderer/store/buildLiveTimeline'
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
function TokenSparkline({
  tl,
  minMs,
  spanMs,
}: {
  tl: SessionTimeline
  minMs: number
  spanMs: number
}) {
  if (tl.tokens.length < 2) return null
  const maxOut = Math.max(...tl.tokens.map((t) => t.outTokens), 1)
  const pts = tl.tokens
    .map((t) => `${((t.tMs - minMs) / spanMs) * 100},${100 - (t.outTokens / maxOut) * 100}`)
    .join(' ')
  const total = tl.tokens[tl.tokens.length - 1].outTokens
  return (
    <div className="tl-spark">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Cumulative output tokens"
      >
        <polyline
          points={pts}
          fill="none"
          stroke="var(--color-chart-1)"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="tl-spark-cap">{total.toLocaleString()} out tok</span>
    </div>
  )
}

export function SessionTimelineView({
  sessionId,
  timelineEvents,
  running,
  freshStart,
}: {
  sessionId: string
  timelineEvents: TimelineEvent[]
  running: boolean
  freshStart: boolean
}) {
  // Re-render clock so running bars grow smoothly.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNowTick(Date.now()), 500)
    return () => clearInterval(id)
  }, [running])

  const hasLive = freshStart && timelineEvents.length > 0
  // Replay: only fetch the transcript when there is no live data for this session.
  const query = trpc.timeline.get.useQuery(
    { sessionId },
    { enabled: !hasLive && sessionId.length > 0 },
  )

  const timeline: SessionTimeline | null = useMemo(() => {
    if (hasLive) return buildLiveTimeline(sessionId, timelineEvents, nowTick)
    return query.data ?? null
  }, [hasLive, sessionId, timelineEvents, nowTick, query.data])

  if (!timeline || timeline.spans.length === 0) {
    return (
      <div className="tl-empty">{query.isLoading ? 'Loading timeline…' : 'No timeline yet'}</div>
    )
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
