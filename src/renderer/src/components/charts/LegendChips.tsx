import type { SeriesDef } from './chartMeta'

// Series chips that double as visibility toggles. A chip in `hidden` renders
// struck-through and dim. Hover shows the series definition (native title).
export function LegendChips({
  series,
  hidden,
  onToggle,
}: {
  series: SeriesDef[]
  hidden: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {series.map((s) => {
        const off = hidden.has(s.key)
        return (
          <button
            key={s.key}
            type="button"
            title={s.definition}
            onClick={() => onToggle(s.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--mono)',
              fontSize: 10,
              padding: '1px 6px',
              border: `1px solid ${off ? 'var(--color-border)' : s.color}`,
              color: off ? 'var(--fg-4)' : s.color,
              background: 'transparent',
              cursor: 'pointer',
              textDecoration: off ? 'line-through' : 'none',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                background: off ? 'transparent' : s.color,
                border: `1px solid ${s.color}`,
              }}
            />
            {s.label}
          </button>
        )
      })}
    </span>
  )
}
