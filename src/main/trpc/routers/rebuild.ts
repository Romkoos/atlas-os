import { logger } from '@main/logger'
import { rebuildRun } from '@main/services/rebuild/registry'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { RebuildEvent } from '@shared/rebuild'
import { observable } from '@trpc/server/observable'

// Build-from-prod → swap → relaunch, driven from Settings. The run itself lives
// in the singleton rebuildRun (decoupled from this subscription), so leaving the
// modal never kills a build; the subscription just replays the log then forwards
// live events.
export const rebuildRouter = router({
  status: publicProcedure.query(() => rebuildRun.snapshot()),

  stream: publicProcedure.subscription(() =>
    observable<RebuildEvent>((emit) => {
      // Replay everything so far, then stream live.
      const snap = rebuildRun.snapshot()
      for (const line of snap.log) emit.next({ state: snap.state, line })
      emit.next({ state: snap.state })

      const onEvent = (event: RebuildEvent): void => emit.next(event)
      rebuildRun.on('event', onEvent)
      return () => rebuildRun.off('event', onEvent)
    }),
  ),

  start: publicProcedure.mutation(() => {
    // Fire-and-forget: progress + terminal state flow over `stream`.
    rebuildRun.start().catch((err) => {
      logger.error('Rebuild start rejected', err instanceof Error ? err.message : String(err))
    })
    return { ok: true }
  }),

  confirmSwap: publicProcedure.mutation(() => {
    rebuildRun.confirmSwap()
    return { ok: true }
  }),

  cancel: publicProcedure.mutation(() => {
    rebuildRun.cancel()
    return { ok: true }
  }),
})
