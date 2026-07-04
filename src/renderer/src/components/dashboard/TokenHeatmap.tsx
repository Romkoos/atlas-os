import { compact, DrillLink, Note } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'
import { useMemo } from 'react'
import { heatmapCells } from './heatmap'

const DAYS = 91 // 13 weeks

// GitHub-style contribution grid of tokens/day. Columns are weeks (top = Sunday);
// leading blanks align the first date to its weekday row.
export function TokenHeatmap() {
  const kpi = trpc.productivity.kpi.useQuery({ days: DAYS })
  const cells = useMemo(() => heatmapCells(kpi.data?.byDay ?? [], DAYS, new Date()), [kpi.data])
  const lead = cells.length > 0 ? new Date(`${cells[0].date}T00:00:00`).getDay() : 0

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="heatmap · 13w" />
        </span>
        <DrillLink to="productivity" label="detail" />
      </div>
      <div className="panel-body">
        {kpi.isLoading ? (
          <Note>loading…</Note>
        ) : (
          <div className="heatmap-grid" aria-hidden>
            {Array.from({ length: lead }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static leading pad
              <span key={`pad-${i}`} className="heatmap-cell pad" />
            ))}
            {cells.map((c) => (
              <span
                key={c.date}
                className="heatmap-cell"
                data-level={c.level}
                title={`${c.date} · ${compact(c.tokens)} tokens`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
