import { trpc } from '@renderer/lib/trpc'
import type { JobsSnapshot, JobView } from '@shared/jobs'
import { skipToken } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

// Human-readable elapsed time. Seconds under a minute, m+ss under an hour,
// h+mm beyond. Clamped at zero so a clock skew never shows a negative.
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

const EMPTY: JobsSnapshot = { running: [], recent: [] }

// Live job snapshot for the top-bar indicator and the dashboard panel. Subscribes
// to jobs.list (gated by `online` via skipToken) and ticks once a second while
// anything runs so consumers can render live elapsed times from `now`.
export function useJobs(online = true): { running: JobView[]; recent: JobView[]; now: number } {
  const [snap, setSnap] = useState<JobsSnapshot>(EMPTY)
  trpc.jobs.list.useSubscription(online ? undefined : skipToken, {
    onData: (data) => setSnap(data),
  })

  const [, setTick] = useState(0)
  useEffect(() => {
    if (snap.running.length === 0) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [snap.running.length])

  return { running: snap.running, recent: snap.recent, now: Date.now() }
}
