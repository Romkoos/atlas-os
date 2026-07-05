import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { RateLimitInfo } from '@shared/ipc-events'
import { subscriptionLimitTokens } from '@shared/settings'
import { observable } from '@trpc/server/observable'

interface UsageSnapshot {
  info: RateLimitInfo | null
  plan: string
  fallbackLimitTokens: number
}

function snapshot(): UsageSnapshot {
  const s = getSettings()
  return {
    info: subscriptionUsage.snapshot(),
    plan: s.subscriptionPlan,
    fallbackLimitTokens: subscriptionLimitTokens(s),
  }
}

export const subscriptionUsageRouter = router({
  get: publicProcedure.query(() => snapshot()),

  // Emit a fresh snapshot on subscribe, then on every change to the cached
  // rate-limit info (fed by any chat run's rate_limit_event).
  watch: publicProcedure.subscription(() =>
    observable<UsageSnapshot>((emit) => {
      emit.next(snapshot())
      return subscriptionUsage.onChange(() => emit.next(snapshot()))
    }),
  ),
})
