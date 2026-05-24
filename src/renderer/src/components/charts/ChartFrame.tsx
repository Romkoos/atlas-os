import { type ReactNode, useCallback, useState } from 'react'
import { ChartReadout } from './ChartReadout'
import type { ChartMeta } from './chartMeta'
import { InfoPopover } from './InfoPopover'
import { LegendChips } from './LegendChips'

// Reusable chart panel. Header carries the title, // caption, legend-chip
// toggles, an optional ? popover, and (when rows are passed) a synced readout.
// Body renders the chart via a render-prop that receives the hidden-series set.
export function ChartFrame({
  meta,
  rows,
  format,
  action,
  children,
}: {
  meta: ChartMeta
  rows?: Array<Record<string, unknown>>
  format?: (key: string, value: number) => string
  action?: ReactNode
  children: (hidden: ReadonlySet<string>) => ReactNode
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const toggle = useCallback((key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  return (
    <div className="panel mt-16">
      <div className="panel-head" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="ttl" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {meta.title}
          {meta.formula ? (
            <InfoPopover label={meta.formula.label} body={meta.formula.body} />
          ) : null}
        </span>
        {meta.series.length > 1 ? (
          <LegendChips series={meta.series} hidden={hidden} onToggle={toggle} />
        ) : null}
        {rows ? <ChartReadout meta={meta} rows={rows} hidden={hidden} format={format} /> : null}
        {action}
      </div>
      <div className="panel-body">
        <div
          style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)', marginBottom: 8 }}
        >
          <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
          {meta.caption}
        </div>
        {children(hidden)}
      </div>
    </div>
  )
}
