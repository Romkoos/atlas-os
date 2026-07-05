import { formatCountdown, gaugeTone } from '@renderer/components/dashboard/subscription-gauge'
import type { UsageWindow } from '@shared/ipc-events'
import { PlasmaRing } from './PlasmaRing'
import { ringColor } from './plasma-ring'
import { clampUtil, PlasmaFooter, ResetLine, useContainerSize, useUsageData } from './usage-shared'

// Pick the 5h session window, falling back to the most-constraining window if the
// session line isn't present.
function pickSession(windows: UsageWindow[]): UsageWindow | null {
  return (
    windows.find((w) => w.label === 'session') ??
    windows.reduce<UsageWindow | null>(
      (a, w) => (a && a.utilization >= w.utilization ? a : w),
      null,
    )
  )
}

/**
 * Session (5h) usage widget — the center-left jewel of the KPI hero band. A single
 * amber plasma ring with a centered %/countdown overlay and a bottom-left
 * updated-stamp + reload button.
 */
export function UsagePlasmaWidget() {
  const { snapshot, now, refresh } = useUsageData()
  const { ref, size } = useContainerSize()

  const session = pickSession(snapshot?.windows ?? [])
  const isIdle = session == null
  const util = clampUtil(session?.utilization ?? 0)
  const status = session?.status ?? 'allowed'
  const tone = gaugeTone(util, status)

  return (
    <div className="plasma-widget" ref={ref}>
      <PlasmaRing
        // Thicker than the weekly widget's rings so the single-ring session
        // widget carries equal visual weight beside the denser weekly one.
        rings={[{ utilization: util, color: ringColor(util, status), lineWidth: 14 }]}
        isIdle={isIdle}
        flash={status === 'rejected'}
        width={size.w}
        height={size.h}
      />

      <div
        className="plasma-overlay"
        role="status"
        aria-label={isIdle ? 'awaiting data' : `${Math.round(util * 100)}% session usage`}
      >
        <div className={`plasma-pct${tone === 'good' ? ' good' : tone === 'bad' ? ' bad' : ''}`}>
          {isIdle ? '—%' : `${Math.round(util * 100)}%`}
        </div>

        {!isIdle && session && status === 'rejected' && (
          <>
            <div className="plasma-reset-label">limit reached</div>
            <div className="plasma-countdown">
              {session.resetsAt != null ? formatCountdown(session.resetsAt - now) : 'window open'}
            </div>
          </>
        )}
        {!isIdle && session && status !== 'rejected' && (
          <ResetLine resetsAt={session.resetsAt} now={now} label="session" />
        )}

        {isIdle && <div className="plasma-reset-label">awaiting data</div>}
      </div>

      <PlasmaFooter fetchedAt={snapshot?.fetchedAt} now={now} refresh={refresh} />
    </div>
  )
}
