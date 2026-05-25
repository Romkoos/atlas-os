import type { ChartMeta } from './chartMeta'
import { useHoverSync } from './HoverSyncContext'

// Renders the hovered day's values for one chart's series, driven by the shared
// active date. `rows` is the chart's data; `format` turns a raw value into text.
export function ChartReadout({
  meta,
  rows,
  hidden,
  format,
}: {
  meta: ChartMeta
  rows: Array<Record<string, unknown>>
  hidden: ReadonlySet<string>
  format?: (key: string, value: number) => string
}) {
  const { activeDate } = useHoverSync()
  if (!activeDate) return null
  const row = rows.find((r) => r.date === activeDate)
  if (!row) return null
  const fmt = format ?? ((_k: string, v: number) => String(v))
  return (
    <span style={{ display: 'inline-flex', gap: 12, fontFamily: 'var(--mono)', fontSize: 11 }}>
      <span style={{ color: 'var(--amber)' }}>{activeDate.slice(5)}</span>
      {meta.series
        .filter((s) => !hidden.has(s.key))
        .map((s) => {
          const v = row[s.key]
          return (
            <span key={s.key} style={{ color: 'var(--fg-4)' }}>
              {s.label}{' '}
              <span style={{ color: 'var(--fg-2)' }}>
                {v == null ? '—' : fmt(s.key, Number(v))}
              </span>
            </span>
          )
        })}
    </span>
  )
}
