import { Note } from '@renderer/components/dashboard/dash-utils'
import { formatCountdown, gaugeTone } from '@renderer/components/dashboard/subscription-gauge'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'
import type { RateLimitInfo } from '@shared/ipc-events'
import { useEffect, useState } from 'react'

export function SubscriptionWidget() {
  const [snap, setSnap] = useState<{ info: RateLimitInfo | null; plan: string } | null>(null)
  trpc.subscriptionUsage.watch.useSubscription(undefined, {
    onData: (d) => setSnap(d),
  })

  // Drive the countdown client-side (1s) from the reset timestamp.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const info = snap?.info ?? null
  const util = info?.utilization ?? 0
  const tone = gaugeTone(util, info?.status ?? 'allowed')
  const remaining = info?.resetsAt ? info.resetsAt - now : null

  return (
    <div className="panel dash-widget">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="subscription" />
        </span>
        <span className="dash-widget-foot">{snap?.plan ?? ''}</span>
      </div>
      <div className="panel-body">
        {info ? (
          <>
            <div
              className={`dash-widget-big ${tone === 'good' ? 'good' : tone === 'warn' ? 'amber' : 'bad'}`}
            >
              {Math.round(util * 100)}%
            </div>
            <div className="dash-widget-sub">
              {info.status === 'rejected' ? 'limit reached' : (info.rateLimitType ?? 'usage')}
            </div>
            <div className="dash-widget-foot">
              {remaining != null ? `resets in ${formatCountdown(remaining)}` : 'window open'}
            </div>
          </>
        ) : (
          <Note>no usage data yet — run a chat.</Note>
        )}
      </div>
    </div>
  )
}
