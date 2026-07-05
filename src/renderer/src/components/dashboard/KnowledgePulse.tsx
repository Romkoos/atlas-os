import { num, timeAgo } from '@renderer/components/dashboard/dash-utils'
import { trpc } from '@renderer/lib/trpc'

// Knowledge-base vitals as a KPI tile: article volume across all project KBs +
// freshness, framed to match the other tiles in the hero band.
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
    <div className="kpi">
      <div className="label">
        <span className="id">[04]</span>KNOWLEDGE
      </div>
      <div className="val">{projects.isLoading || rows.length === 0 ? '—' : num(articles)}</div>
      <div className="delta">
        {rows.length === 0
          ? 'no knowledge bases yet'
          : `${num(rows.length)} projects · ${num(daily)} logs · ${timeAgo(freshest)}`}
      </div>
    </div>
  )
}
