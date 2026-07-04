/** Traveling light along the border of the nearest positioned parent.
 * Pure CSS animation: it costs nothing while its container is display:none
 * (the browser doesn't run animations on non-rendered elements) and the
 * reduced-motion media block can actually disable it. */
export function BorderBeam({
  size = 56,
  duration = 5,
  color = 'var(--amber)',
}: {
  size?: number
  duration?: number
  color?: string
}) {
  return (
    <div className="fx-border-beam-wrap" aria-hidden>
      <div
        className="fx-border-beam"
        style={{
          width: size,
          background: `linear-gradient(to left, ${color}, transparent)`,
          offsetPath: 'rect(0 auto auto 0)',
          animationDuration: `${duration}s`,
        }}
      />
    </div>
  )
}
