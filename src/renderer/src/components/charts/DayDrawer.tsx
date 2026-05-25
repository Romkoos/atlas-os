import { cn } from '@renderer/lib/utils'
import { useEffect } from 'react'
import { type DaySummary, summarizeDay } from './daySessions'

export interface DrawerSession {
  sessionId: string
  project: string
  projectPath: string
  totalTokens: number
  kpi: number | null
  complexity: number | null
  turnCount: number
  summary: string | null
}

const fmtInt = new Intl.NumberFormat('en-US')
const num = (n: number): string => fmtInt.format(n)
const pct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(0)}%`)
const dash = (v: number | null, d = 1): string => (v == null ? '—' : v.toFixed(d))

// Right-side slide-in drawer for one day's drilldown. Backdrop + Esc close.
// `sessions` is already filtered to `day` by the caller.
export function DayDrawer({
  day,
  sessions,
  loading,
  onClose,
}: {
  day: string | null
  sessions: DrawerSession[]
  loading: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (day == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [day, onClose])

  if (day == null) return null
  const sum: DaySummary = summarizeDay(sessions)

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50 }}>
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          border: 0,
          cursor: 'default',
        }}
      />
      {/* panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Sessions on ${day}`}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(440px, 90vw)',
          background: 'var(--color-background)',
          borderLeft: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          className="panel-head"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span className="ttl">
            <span style={{ color: 'var(--amber)' }}>{day}</span> · sessions
          </span>
          <button type="button" className="btn" onClick={onClose}>
            ✕ CLOSE
          </button>
        </div>

        {/* summary */}
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--line-dim)',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--fg-4)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 20px',
          }}
        >
          <span>
            <span style={{ color: 'var(--fg)' }} className="tabular-nums">
              {sum.count}
            </span>{' '}
            sessions
          </span>
          <span>
            <span style={{ color: 'var(--fg)' }} className="tabular-nums">
              {num(sum.totalTokens)}
            </span>{' '}
            tokens
          </span>
          <span>
            <span style={{ color: 'var(--amber)' }} className="tabular-nums">
              {pct(sum.avgKpi)}
            </span>{' '}
            avg Eff
          </span>
        </div>

        {/* by project */}
        {sum.byProject.length > 0 ? (
          <div
            style={{
              padding: '8px 14px',
              borderBottom: '1px solid var(--line-dim)',
              fontFamily: 'var(--mono)',
              fontSize: 11,
            }}
          >
            {sum.byProject.map((p) => (
              <div
                key={p.project}
                style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fg-3)' }}
              >
                <span className="truncate" title={p.project}>
                  {p.project}
                </span>
                <span className="tabular-nums" style={{ color: 'var(--fg-4)' }}>
                  {num(p.tokens)} · {p.sessions}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {/* session list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <p
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--fg-4)',
                padding: '12px 14px',
              }}
            >
              <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>loading…
            </p>
          ) : sessions.length === 0 ? (
            <p
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--fg-4)',
                padding: '12px 14px',
              }}
            >
              <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>no sessions loaded for this
              day.
            </p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column' }}>
              {sessions.map((s) => (
                <li
                  key={s.sessionId}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--line-dim)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ color: 'var(--fg-2)' }} title={s.projectPath}>
                      {s.project}
                    </span>
                    <span
                      className={cn('tabular-nums')}
                      style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)' }}
                    >
                      {num(s.totalTokens)} tok · {pct(s.kpi)} · cx {dash(s.complexity)} ·{' '}
                      {num(s.turnCount)}t
                    </span>
                  </div>
                  {s.summary ? (
                    <span
                      className="line-clamp-2"
                      style={{ fontSize: 12, color: 'var(--fg-3)' }}
                      title={s.summary}
                    >
                      {s.summary}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
