import { JobIndicator } from '@renderer/components/layout/JobIndicator'
import { NAV } from '@renderer/components/layout/nav'
import { trpc } from '@renderer/lib/trpc'
import type { Section } from '@renderer/store/ui'
import { useEffect, useState } from 'react'

function useClock(): string {
  const [time, setTime] = useState(() => new Date().toTimeString().slice(0, 8))
  useEffect(() => {
    const id = setInterval(() => setTime(new Date().toTimeString().slice(0, 8)), 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const win = () => window.atlas.window

export function TitleBar({ section }: { section: Section }) {
  const clock = useClock()
  const health = trpc.health.ping.useQuery(undefined, { refetchInterval: 5000 })
  const active = NAV.find((n) => n.id === section) ?? NAV[0]
  const online = !health.isError && Boolean(health.data?.ok)

  return (
    <div className="win-bar">
      <div className="tl">
        <button type="button" className="r" aria-label="Close" onClick={() => win().close()} />
        <button
          type="button"
          className="y"
          aria-label="Minimize"
          onClick={() => win().minimize()}
        />
        <button
          type="button"
          className="g"
          aria-label="Toggle maximize"
          onClick={() => win().toggleMaximize()}
        />
      </div>
      <div className="path">
        <b>atlas-os</b>
        <span style={{ color: 'var(--fg-4)', margin: '0 8px' }}>/</span>
        <span>{active.label.toLowerCase()}</span>
      </div>
      <div className="right">
        {health.data ? <span>uptime {formatUptime(health.data.uptimeMs)}</span> : null}
        {health.data ? <span>mem {health.data.memMB}M</span> : null}
        <JobIndicator online={online} />
        <span style={{ color: 'var(--fg-3)', fontVariantNumeric: 'tabular-nums' }}>{clock}</span>
      </div>
    </div>
  )
}
