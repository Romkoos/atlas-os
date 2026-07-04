import { BorderBeam } from '@renderer/components/fx/BorderBeam'
import { formatDuration, useJobs } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import type { JobView } from '@shared/jobs'

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

// Top-bar process indicator. Shows idle when nothing runs, a live count while
// jobs run, and backend.down when the backend is unreachable. Hovering reveals
// running + recent jobs.
export function JobIndicator({ online }: { online: boolean }) {
  const { running, recent, now } = useJobs(online)

  if (!online) return <span className="down">● backend.down</span>

  const count = running.length
  const empty = running.length === 0 && recent.length === 0

  return (
    <span className={count > 0 ? 'jobs live' : 'jobs'}>
      <span className="jobs-label">{count === 0 ? '● idle' : `◐ ${count} running`}</span>
      <div className="jobs-pop">
        {count > 0 ? <BorderBeam size={40} duration={4} /> : null}
        {empty ? <div className="jobs-empty">no recent processes</div> : null}
        {running.map((j) => (
          <JobRow key={j.id} job={j} now={now} />
        ))}
        {recent.map((j) => (
          <JobRow key={j.id} job={j} now={now} />
        ))}
      </div>
    </span>
  )
}
