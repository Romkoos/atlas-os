import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { pollUsageOnce } from '@main/services/chat/usagePoll'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { UsageSnapshot } from '@shared/ipc-events'
import { subscriptionLimitTokens } from '@shared/settings'
import { observable } from '@trpc/server/observable'

interface UsagePayload {
  snapshot: UsageSnapshot | null
  plan: string
  fallbackLimitTokens: number
}

function payload(): UsagePayload {
  const s = getSettings()
  return {
    snapshot: subscriptionUsage.snapshot(),
    plan: s.subscriptionPlan,
    fallbackLimitTokens: subscriptionLimitTokens(s),
  }
}

export const subscriptionUsageRouter = router({
  get: publicProcedure.query(() => payload()),

  // Emit a fresh payload on subscribe, then on every change to the cached usage
  // snapshot (fed by the periodic poll and by live chat rate_limit_events).
  watch: publicProcedure.subscription(() =>
    observable<UsagePayload>((emit) => {
      emit.next(payload())
      return subscriptionUsage.onChange(() => emit.next(payload()))
    }),
  ),

  // Manually re-run `/usage` now (the widget's reload button). Updates the cache
  // on success, which pushes a fresh payload to `watch` subscribers. Returns
  // whether fresh data was obtained.
  refresh: publicProcedure.mutation(async () => {
    const windows = await pollUsageOnce()
    if (windows) subscriptionUsage.updateFromPoll(windows, Date.now())
    return { ok: windows !== null }
  }),
})
