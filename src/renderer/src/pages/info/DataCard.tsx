import { Fragment, type ReactNode } from 'react'

export interface DataCardRow {
  label: string
  value: ReactNode
  hint?: string
}

// Reuses the existing .panel + .kv styles from sidebar/Settings.
// `loading` and `empty` are rendered as muted single-line messages.
export function DataCard({
  title,
  rows,
  loading,
  empty,
}: {
  title: string
  rows: DataCardRow[]
  loading?: boolean
  empty?: string | null
}) {
  return (
    <div className="panel mt-16">
      <div className="panel-head">
        <span className="ttl">{title}</span>
      </div>
      <div className="panel-body">
        {loading ? (
          <p style={{ color: 'var(--color-muted-fg)' }}>загружается…</p>
        ) : empty ? (
          <p style={{ color: 'var(--color-muted-fg)' }}>{empty}</p>
        ) : (
          <div className="kv" style={{ gridTemplateColumns: '220px 1fr' }}>
            {rows.map((r) => (
              <Fragment key={r.label}>
                <div className="k" title={r.hint}>
                  {r.label}
                </div>
                <div className="v tabular-nums">{r.value}</div>
              </Fragment>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
