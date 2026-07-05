import { compact } from '@renderer/components/dashboard/dash-utils'
import { trpc } from '@renderer/lib/trpc'
import { type CSSProperties, useMemo } from 'react'
import { heatmapCells } from './heatmap'

const DAYS = 91 // 13 weeks

// GitHub-style contribution grid of tokens/day, styled as a KPI tile so it sits
// flush with the other tiles in the hero band. Columns are weeks (top = Sunday);
// leading blanks align the first date to its weekday row. The grid's column
// count is derived so the square cells stretch to fill the tile width exactly.
export function TokenHeatmap() {
  const kpi = trpc.productivity.kpi.useQuery({ days: DAYS })
  const cells = useMemo(() => heatmapCells(kpi.data?.byDay ?? [], DAYS, new Date()), [kpi.data])
  const lead = cells.length > 0 ? new Date(`${cells[0].date}T00:00:00`).getDay() : 0
  const weeks = Math.ceil((cells.length + lead) / 7)

  return (
    <div className="kpi kpi-heatmap">
      <div className="label">
        <span className="id">[03]</span>HEATMAP · 13W
      </div>
      {kpi.isLoading ? (
        <div className="val">—</div>
      ) : (
        <div className="heatmap-grid" style={{ '--weeks': weeks } as CSSProperties} aria-hidden>
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
  )
}
