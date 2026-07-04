import { DrillLink, Note, timeAgo } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'

// Latest benchmark batch: live phase while running, else the headline token
// delta from the most recent A/B analysis.
export function BenchmarkWidget() {
  const latest = trpc.benchmark.latest.useQuery()
  const analysis = trpc.benchmark.latestAnalysis.useQuery()

  const live = latest.data && latest.data.phase !== 'done' ? latest.data : null
  const rows = analysis.data?.dataJson ?? []
  const avgTokensDelta =
    rows.length > 0 ? rows.reduce((s, r) => s + r.tokens.pctDelta, 0) / rows.length : null

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="benchmark" />
        </span>
        <DrillLink to="productivity" label="runs" />
      </div>
      <div className="panel-body">
        {live ? (
          <>
            <div className="dash-widget-big amber">
              {live.done}/{live.total}
            </div>
            <div className="dash-widget-sub">{live.phase.toUpperCase()}</div>
            <div className="dash-widget-foot">
              {live.failed > 0 ? `${live.failed} failed` : 'in flight'}
            </div>
          </>
        ) : avgTokensDelta != null && analysis.data ? (
          <>
            <div className={`dash-widget-big ${avgTokensDelta <= 0 ? 'good' : 'bad'}`}>
              {avgTokensDelta > 0 ? '+' : ''}
              {avgTokensDelta.toFixed(1)}%
            </div>
            <div className="dash-widget-sub">tokens vs previous infra</div>
            <div className="dash-widget-foot">analyzed {timeAgo(analysis.data.createdAt)}</div>
          </>
        ) : (
          <Note>no benchmark runs yet.</Note>
        )}
      </div>
    </div>
  )
}
