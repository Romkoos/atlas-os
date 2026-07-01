export type ViewMode = '2d' | '3d'

// Reusable 2D/3D switch for any force graph on the Knowledge page. Styled like
// the existing control buttons; the active mode gets the `on` class.
export function ViewToggle({
  value,
  onChange,
}: {
  value: ViewMode
  onChange: (v: ViewMode) => void
}) {
  return (
    <div className="kb-graph-toggle">
      <button
        type="button"
        className={`btn ${value === '2d' ? 'on' : ''}`}
        onClick={() => onChange('2d')}
      >
        2D
      </button>
      <button
        type="button"
        className={`btn ${value === '3d' ? 'on' : ''}`}
        onClick={() => onChange('3d')}
      >
        3D
      </button>
    </div>
  )
}
