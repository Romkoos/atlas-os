import { num, pct } from '@renderer/components/dashboard/dash-utils'
import { useUsageData } from '@renderer/components/dashboard/usage-shared'
import { formatDuration, useJobs } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import { pickTrayUsage, utilPct } from '@renderer/pages/tray/tray-usage'
import '@renderer/pages/tray/tray.css'

const nav = (section: string): void => window.atlas.tray.navigate(section)

export function TrayHud() {
  const today = trpc.productivity.today.useQuery({})
  const kpi = trpc.productivity.kpi.useQuery({ days: 30 })
  const { snapshot } = useUsageData()
  const { running, now } = useJobs()
  const cancel = trpc.jobs.cancel.useMutation()

  const t = today.data?.totals
  const { session, week } = pickTrayUsage(snapshot?.windows ?? [])

  return (
    <div className="tray-hud">
      <button type="button" className="tray-head" onClick={() => nav('dashboard')}>
        <span className="tray-dot" aria-hidden />
        ATLAS.OS
        <span className="tray-head-hint">dashboard →</span>
      </button>

      <button type="button" className="tray-block" onClick={() => nav('productivity')}>
        <div className="tray-row">
          <span className="tray-k">TOKENS TODAY</span>
          <span className="tray-v amber">{t ? num(t.totalTokens) : '—'}</span>
        </div>
        <div className="tray-row">
          <span className="tray-k">TURNS / SESSIONS</span>
          <span className="tray-v">{t ? `${num(t.turns)} / ${num(t.sessions)}` : '—'}</span>
        </div>
        <div className="tray-row">
          <span className="tray-k">EFF</span>
          <span className="tray-v">{pct(kpi.data?.overall)}</span>
        </div>
      </button>

      <button type="button" className="tray-block" onClick={() => nav('dashboard')}>
        <div className="tray-row">
          <span className="tray-k">SESSION · 5H</span>
          <span className="tray-v">{utilPct(session)}</span>
        </div>
        <div className="tray-row">
          <span className="tray-k">WEEK · 7D</span>
          <span className="tray-v">{utilPct(week)}</span>
        </div>
      </button>

      <section className="tray-jobs">
        <div className="tray-jobs-head">PROCESSES</div>
        {running.length === 0 ? (
          <div className="tray-idle">no active processes</div>
        ) : (
          running.map((j) => (
            <button key={j.id} type="button" className="tray-job" onClick={() => nav('dashboard')}>
              <span className="tray-job-spin" aria-hidden />
              <span className="tray-job-label">{j.label}</span>
              <span className="tray-job-elapsed">{formatDuration(now - j.startedAt)}</span>
              {j.cancellable && (
                // biome-ignore lint/a11y/useSemanticElements: nested inside .tray-job button; a real <button> here is invalid (button-in-button)
                <span
                  role="button"
                  tabIndex={0}
                  className="tray-job-x"
                  aria-label="Abort process"
                  onClick={(e) => {
                    e.stopPropagation()
                    cancel.mutate({ jobId: j.id })
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation()
                      cancel.mutate({ jobId: j.id })
                    }
                  }}
                >
                  ✕
                </span>
              )}
            </button>
          ))
        )}
      </section>

      <footer className="tray-foot">
        <button type="button" onClick={() => window.atlas.tray.openMain()}>
          Open Atlas
        </button>
        <button type="button" onClick={() => window.atlas.tray.quit()}>
          Quit
        </button>
      </footer>
    </div>
  )
}
