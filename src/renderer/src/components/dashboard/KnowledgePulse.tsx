import { DrillLink, Note, num, timeAgo } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'

// Knowledge-base vitals: article volume across all project KBs + freshness.
export function KnowledgePulse() {
  const projects = trpc.knowledge.projects.useQuery()
  const rows = projects.data ?? []
  const articles = rows.reduce((s, p) => s + p.articleCount, 0)
  const daily = rows.reduce((s, p) => s + p.dailyCount, 0)
  const freshest = rows.reduce<string | null>(
    (m, p) => (p.lastUpdated && (!m || p.lastUpdated > m) ? p.lastUpdated : m),
    null,
  )

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="knowledge" />
        </span>
        <DrillLink to="knowledge" label="browse" />
      </div>
      <div className="panel-body">
        {projects.isLoading ? (
          <Note>loading…</Note>
        ) : rows.length === 0 ? (
          <Note>no knowledge bases yet.</Note>
        ) : (
          <>
            <div className="dash-widget-big">{num(articles)}</div>
            <div className="dash-widget-sub">articles · {num(rows.length)} projects</div>
            <div className="dash-widget-foot">
              {num(daily)} logs · updated {timeAgo(freshest)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
