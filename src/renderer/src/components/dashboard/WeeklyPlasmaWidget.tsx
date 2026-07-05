import { PlasmaRing, type RingSpec } from './PlasmaRing'
import { typeColor } from './plasma-ring'
import { clampUtil, ResetLine, useContainerSize, useUsageData } from './usage-shared'

const pct = (u: number) => `${Math.round(clampUtil(u) * 100)}%`

/**
 * Weekly (7d) usage widget — mirrors the session widget but draws two concentric
 * rings: outer = week (all models, sky), inner = week (Fable, violet). The overlay
 * shows both %s and a shared reset countdown (the weekly windows reset together).
 */
export function WeeklyPlasmaWidget() {
  const { snapshot, now } = useUsageData()
  const { ref, size } = useContainerSize()

  const windows = snapshot?.windows ?? []
  const week = windows.find((w) => w.label === 'week') ?? null
  // The per-model weekly window is labelled e.g. "week · Fable".
  const fable = windows.find((w) => w.label.startsWith('week ·')) ?? null
  const isIdle = week == null && fable == null

  // Outer ring matches the session ring's diameter (0.38); the inner ring sits
  // snug just inside it (0.33) so the pair reads as one nested gauge.
  const rings: RingSpec[] = []
  if (week)
    rings.push({
      utilization: clampUtil(week.utilization),
      color: typeColor('week'),
      radiusScale: 0.38,
    })
  if (fable)
    rings.push({
      utilization: clampUtil(fable.utilization),
      color: typeColor('fable'),
      radiusScale: 0.33,
    })

  const flash = week?.status === 'rejected' || fable?.status === 'rejected'
  const resetSrc = week ?? fable

  return (
    <div className="plasma-widget" ref={ref}>
      <PlasmaRing rings={rings} isIdle={isIdle} flash={flash} width={size.w} height={size.h} />

      <div className="plasma-overlay" role="status" aria-label="weekly usage">
        {isIdle ? (
          <>
            <div className="plasma-pct">—%</div>
            <div className="plasma-reset-label">awaiting data</div>
          </>
        ) : (
          <>
            <div className="plasma-week-vals">
              {week && <span className="pw-val week">{pct(week.utilization)}</span>}
              {week && fable && <span className="pw-sep">/</span>}
              {fable && <span className="pw-val fable">{pct(fable.utilization)}</span>}
            </div>
            <ResetLine resetsAt={resetSrc?.resetsAt} now={now} label="week" />
            <div className="plasma-week-legend">
              {week && <span className="lg week">week</span>}
              {fable && <span className="lg fable">fable</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
