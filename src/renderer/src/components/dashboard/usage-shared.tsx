import {
  formatCountdown,
  formatResetClock,
  RESET_COUNTDOWN_THRESHOLD_MS,
} from '@renderer/components/dashboard/subscription-gauge'
import { trpc } from '@renderer/lib/trpc'
import type { UsageSnapshot } from '@shared/ipc-events'
import { useEffect, useRef, useState } from 'react'

export const clampUtil = (u: number) => Math.min(1, Math.max(0, u))

// "just now" / "4m ago" / "2h ago" from an elapsed-ms delta.
export function relativeTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

type RefreshMutation = { mutate: () => void; isPending: boolean }

// Shared subscription + 1s tick + manual refresh, used by both usage widgets.
export function useUsageData(): {
  snapshot: UsageSnapshot | null
  now: number
  refresh: RefreshMutation
} {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null)
  trpc.subscriptionUsage.watch.useSubscription(undefined, {
    onData: (d) => setSnapshot(d.snapshot),
  })
  const refresh = trpc.subscriptionUsage.refresh.useMutation()

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return { snapshot, now, refresh }
}

// Measure a container for responsive canvas sizing.
export function useContainerSize() {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 200, h: 200 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, size }
}

// Reset display shared by both widgets: a live HH:MM:SS countdown when the reset
// is under a day away, otherwise an absolute "resets Sat 5:59 AM" (matching the
// Claude app). `label` prefixes the caption, e.g. 'session' / 'week'.
export function ResetLine({
  resetsAt,
  now,
  label,
}: {
  resetsAt?: number
  now: number
  label: string
}) {
  if (resetsAt == null) {
    return (
      <>
        <div className="plasma-reset-label">{label} · resets in</div>
        <div className="plasma-countdown">window open</div>
      </>
    )
  }
  const remaining = resetsAt - now
  const soon = remaining < RESET_COUNTDOWN_THRESHOLD_MS
  return (
    <>
      <div className="plasma-reset-label">
        {label} · resets{soon ? ' in' : ''}
      </div>
      <div className="plasma-countdown">
        {soon ? formatCountdown(remaining) : formatResetClock(resetsAt)}
      </div>
    </>
  )
}

// Bottom-left "updated Xm ago" + reload button, shared by both widgets.
export function PlasmaFooter({
  fetchedAt,
  now,
  refresh,
}: {
  fetchedAt?: number
  now: number
  refresh: RefreshMutation
}) {
  return (
    <div className="plasma-footer">
      <button
        type="button"
        className={`plasma-reload${refresh.isPending ? ' spinning' : ''}`}
        onClick={() => refresh.mutate()}
        disabled={refresh.isPending}
        title="Refresh usage now"
        aria-label="Refresh usage"
      >
        ⟳
      </button>
      <span className="plasma-updated">
        {fetchedAt != null ? `updated ${relativeTime(now - fetchedAt)}` : 'no data yet'}
      </span>
    </div>
  )
}
