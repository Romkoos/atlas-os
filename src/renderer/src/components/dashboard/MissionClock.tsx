import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { formatDuration } from '@renderer/hooks/useJobs'
import { trpc } from '@renderer/lib/trpc'
import { useEffect, useState } from 'react'

const pad = (n: number): string => String(n).padStart(2, '0')

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d.getTime() - start.getTime()) / 86_400_000)
}

// Pure ambient: local mission time, UTC, day-of-year, app uptime + vitals.
export function MissionClock() {
  const health = trpc.health.ping.useQuery(undefined, { refetchInterval: 60_000 })
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="mission time" />
        </span>
        <span className="meta">DOY {dayOfYear(now)}</span>
      </div>
      <div className="panel-body">
        <div className="dash-widget-big clock">
          {pad(now.getHours())}:{pad(now.getMinutes())}
          <span className="clock-sec">:{pad(now.getSeconds())}</span>
        </div>
        <div className="dash-widget-sub">
          UTC {pad(now.getUTCHours())}:{pad(now.getUTCMinutes())}
        </div>
        <div className="dash-widget-foot">
          up {health.data ? formatDuration(health.data.uptimeMs) : '—'} · v
          {health.data?.version ?? '—'} · {health.data?.memMB ?? '—'}M
        </div>
      </div>
    </div>
  )
}
