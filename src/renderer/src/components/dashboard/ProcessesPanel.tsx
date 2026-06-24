import { formatDuration, useJobs } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import type { JobView } from '@shared/jobs'

function ProcRow({ job, now }: { job: JobView; now: number }) {
  const cancel = trpc.jobs.cancel.useMutation()
  const reveal = trpc.jobs.reveal.useMutation()
  const elapsed = (job.endedAt ?? now) - job.startedAt
  const icon = job.status === 'running' ? '◐' : job.status === 'done' ? '✓' : '✗'
  return (
    <div className={`proc-row ${job.status}`}>
      <span className="proc-icon">{icon}</span>
      <span className="proc-label">
        {job.label}
        <span className="proc-kind">{job.kind}</span>
      </span>
      <span className="proc-model">{job.model ?? '—'}</span>
      <span className="proc-tokens">{job.tokens != null ? job.tokens.toLocaleString() : '—'}</span>
      <span className="proc-detail">{job.error ?? job.detail ?? ''}</span>
      <span className="proc-time">{formatDuration(elapsed)}</span>
      <span className="proc-actions">
        {job.status === 'running' && job.cancellable ? (
          <button
            type="button"
            className="proc-x"
            aria-label="Abort process"
            onClick={() => cancel.mutate({ jobId: job.id })}
          >
            ✕
          </button>
        ) : null}
        {job.status !== 'running' && job.resultPath ? (
          <button
            type="button"
            className="proc-open"
            aria-label="Open output"
            onClick={() => reveal.mutate({ jobId: job.id })}
          >
            ↗
          </button>
        ) : null}
      </span>
    </div>
  )
}

// Full-width dashboard panel: active processes on top, last 10 completed below,
// with model/tokens/detail meta and cancel/open actions.
export function ProcessesPanel() {
  const { running, recent, now } = useJobs()
  return (
    <div className="panel mt-16">
      <div className="panel-head">
        <span className="ttl">processes</span>
      </div>
      <div className="panel-body">
        <div className="proc-group">active</div>
        {running.length === 0 ? (
          <div className="proc-empty">nothing running</div>
        ) : (
          running.map((j) => <ProcRow key={j.id} job={j} now={now} />)
        )}
        <div className="proc-group proc-group-recent">recent · 10</div>
        {recent.length === 0 ? (
          <div className="proc-empty">no recent processes</div>
        ) : (
          recent.map((j) => <ProcRow key={j.id} job={j} now={now} />)
        )}
      </div>
    </div>
  )
}
