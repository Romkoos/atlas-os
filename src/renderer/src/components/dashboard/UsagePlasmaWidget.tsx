import { formatCountdown, gaugeTone } from '@renderer/components/dashboard/subscription-gauge'
import { trpc } from '@renderer/lib/trpc'
import type { RateLimitInfo } from '@shared/ipc-events'
import { useEffect, useRef, useState } from 'react'
import { PlasmaRing } from './PlasmaRing'

/**
 * Center jewel of the KPI hero band.
 * Subscribes to live subscription-usage updates, measures its container,
 * and renders a Canvas plasma ring with an HTML text overlay.
 */
export function UsagePlasmaWidget() {
  const [snap, setSnap] = useState<{ info: RateLimitInfo | null; plan: string } | null>(null)
  trpc.subscriptionUsage.watch.useSubscription(undefined, {
    onData: (d) => setSnap(d),
  })

  // Client-side 1 s countdown tick.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Measure container for responsive canvas sizing.
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 200, h: 200 })
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const info = snap?.info ?? null
  // utilization is optional in SDKRateLimitInfo — treat its absence the same as
  // info === null (no data yet). Mapping undefined → 0 would show a broken "0%"
  // with an empty ring arc instead of the intended idle animation.
  const rawUtil = info?.utilization
  const isIdle = info === null || rawUtil === undefined
  const util = rawUtil ?? 0
  const status = info?.status ?? 'allowed'
  const tone = gaugeTone(util, status)
  const remaining = info?.resetsAt != null ? info.resetsAt - now : null
  const plan = snap?.plan ?? ''
  const rateType = info?.rateLimitType ?? ''

  return (
    <div className="plasma-widget" ref={containerRef}>
      <PlasmaRing
        utilization={util}
        status={status}
        isIdle={isIdle}
        width={size.w}
        height={size.h}
      />

      <div
        className="plasma-overlay"
        role="status"
        aria-label={isIdle ? 'awaiting data' : `${Math.round(util * 100)}% usage`}
      >
        <div className={`plasma-pct${tone === 'good' ? ' good' : tone === 'bad' ? ' bad' : ''}`}>
          {isIdle ? '—%' : `${Math.round(util * 100)}%`}
        </div>

        {!isIdle && (
          <>
            <div className="plasma-reset-label">
              {status === 'rejected' ? 'limit reached' : 'resets in'}
            </div>
            <div className="plasma-countdown">
              {remaining != null ? formatCountdown(remaining) : 'window open'}
            </div>
            {(plan || rateType) && (
              <div className="plasma-meta">{[plan, rateType].filter(Boolean).join(' · ')}</div>
            )}
          </>
        )}

        {isIdle && <div className="plasma-reset-label">awaiting data</div>}
      </div>
    </div>
  )
}
