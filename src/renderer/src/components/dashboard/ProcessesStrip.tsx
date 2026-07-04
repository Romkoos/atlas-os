import { compact } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { formatDuration, useJobs } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import type { JobView } from '@shared/jobs'
import { useState } from 'react'

// Compact processes strip: active jobs as live chips; completed history is
// hidden behind the `history` toggle. Replaces the old two-table panel.
export function ProcessesStrip() {
  const { running, recent, now } = useJobs()
  const [historyOpen, setHistoryOpen] = useState(false)
  const cancel = trpc.jobs.cancel.useMutation()
  const reveal = trpc.jobs.reveal.useMutation()

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="processes" />
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {running.length > 0 && <span className="fx-radar" aria-hidden />}
          <button
            type="button"
            className="procstrip-toggle"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            history {historyOpen ? '▴' : '▾'}
          </button>
        </div>
      </div>
      <div className="panel-body">
        {running.length === 0 ? (
          <div className="procstrip-idle">{'// all systems idle'}</div>
        ) : (
          <div className="procstrip-chips">
            {running.map((j) => (
              <span key={j.id} className="procstrip-chip">
                <span className="procstrip-spin" aria-hidden />
                {j.label}
                <span className="procstrip-elapsed">{formatDuration(now - j.startedAt)}</span>
                {j.cancellable && (
                  <button
                    type="button"
                    className="procstrip-x"
                    aria-label="Abort process"
                    onClick={() => cancel.mutate({ jobId: j.id })}
                  >
                    ✕
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {historyOpen && (
          <div className="procstrip-history">
            {recent.length === 0 ? (
              <div className="procstrip-idle">{'// no recent processes'}</div>
            ) : (
              recent.map((j: JobView) => (
                <div key={j.id} className="procstrip-row" title={j.error ?? j.detail ?? ''}>
                  <span className={j.status === 'done' ? 'ok' : 'err'}>
                    {j.status === 'done' ? '✓' : '✗'}
                  </span>
                  <span className="procstrip-label">{j.label}</span>
                  <span className="procstrip-meta">
                    {j.tokens != null ? `${compact(j.tokens)} tok` : '—'}
                  </span>
                  <span className="procstrip-meta">
                    {formatDuration((j.endedAt ?? now) - j.startedAt)}
                  </span>
                  {j.resultPath ? (
                    <button
                      type="button"
                      className="procstrip-open"
                      aria-label="Open output"
                      onClick={() => reveal.mutate({ jobId: j.id })}
                    >
                      ↗
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
