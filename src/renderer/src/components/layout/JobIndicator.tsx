import { trpc } from '@renderer/lib/trpc'
import type { JobsSnapshot, JobView } from '@shared/jobs'
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

function JobRow({ job, now }: { job: JobView; now: number }) {
  const cancel = trpc.jobs.cancel.useMutation()
  const elapsed = (job.endedAt ?? now) - job.startedAt
  const icon = job.status === 'running' ? '◐' : job.status === 'done' ? '✓' : '✗'
  return (
    <div className={`jobs-row ${job.status}`}>
      <span className="jobs-icon">{icon}</span>
      <span className="jobs-name">{job.label}</span>
      <span className="jobs-time">{formatDuration(elapsed)}</span>
      {job.status === 'running' && job.cancellable ? (
        <button
          type="button"
          className="jobs-x"
          aria-label="Abort process"
          onClick={() => cancel.mutate({ jobId: job.id })}
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}

// Top-bar process indicator. Replaces the static backend.ok string: shows idle
// when nothing runs, a live count while jobs run, and backend.down when the
// backend is unreachable. Hovering reveals running + recent jobs.
export function JobIndicator({ online }: { online: boolean }) {
  const [snap, setSnap] = useState<JobsSnapshot>(EMPTY)
  trpc.jobs.list.useSubscription(undefined, {
    onData: (data) => setSnap(data),
  })

  // Tick once a second only while something is running, to advance the live
  // elapsed counters without a server round-trip.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (snap.running.length === 0) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [snap.running.length])

  if (!online) return <span className="down">● backend.down</span>

  const count = snap.running.length
  const now = Date.now()
  const empty = snap.running.length === 0 && snap.recent.length === 0

  return (
    <span className={`jobs ${count > 0 ? 'live' : ''}`}>
      <span className="jobs-label">{count === 0 ? '● idle' : `◐ ${count} running`}</span>
      <div className="jobs-pop">
        {empty ? <div className="jobs-empty">no recent processes</div> : null}
        {snap.running.map((j) => (
          <JobRow key={j.id} job={j} now={now} />
        ))}
        {snap.recent.map((j) => (
          <JobRow key={j.id} job={j} now={now} />
        ))}
      </div>
    </span>
  )
}
