import { db } from '@main/db/client'
import { events } from '@main/db/schema'
import { logger } from '@main/logger'
import { jobRegistry } from '@main/services/jobs/registry'
import { type ImproverRun, startImproverRun } from '@main/services/skillImprover'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { ImproverEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

// Active runs keyed by requestId so reply/accept/reject can reach them.
const runs = new Map<string, ImproverRun>()

export const skillImproverRouter = router({
  start: publicProcedure
    .input(
      z.object({
        requestId: z.string().min(1),
        skillId: z.string().min(1),
      }),
    )
    .subscription(({ input }) =>
      observable<ImproverEvent>((emit) => {
        // Model resolved server-side from settings, mirroring the news router.
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const job = jobRegistry.register({
          kind: 'skill.improve',
          label: 'Skill improver',
          // Resolve via the runs map so we don't reference `run` before its
          // declaration; cancel reverts the workspace.
          abort: () => runs.get(input.requestId)?.cancel(),
        })
        const run = startImproverRun({
          requestId: input.requestId,
          skillId: input.skillId,
          model,
          emit: (event) => {
            // Log a stats event when the session ends (applied or reverted) so the
            // run shows up in Stats — the tokens/time were spent either way.
            if (event.type === 'done' || event.type === 'aborted') {
              db()
                .insert(events)
                .values({
                  type: 'skill.improve',
                  model,
                  tokens: event.tokens,
                  durationMs: event.durationMs,
                })
                .run()
              logger.info('Skill improvement recorded', {
                skillId: input.skillId,
                applied: event.type === 'done',
                tokens: event.tokens,
                durationMs: event.durationMs,
              })
              job.finish(event.type === 'done' ? 'done' : 'error')
            }
            if (event.type === 'error') job.finish('error')
            emit.next(event)
          },
        })
        runs.set(input.requestId, run)

        // Teardown on unsubscribe: if the renderer drops the subscription without
        // an explicit accept/reject (e.g. window closed), cancel + revert.
        return () => {
          const r = runs.get(input.requestId)
          if (r) {
            r.cancel()
            runs.delete(input.requestId)
          }
          job.finish('error')
        }
      }),
    ),

  reply: publicProcedure
    .input(z.object({ requestId: z.string().min(1), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.reply(input.text)
      return { ok: Boolean(run) }
    }),

  accept: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      const run = runs.get(input.requestId)
      if (run) {
        await run.accept()
        runs.delete(input.requestId)
      }
      return { ok: Boolean(run) }
    }),

  reject: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      const run = runs.get(input.requestId)
      if (run) {
        await run.reject()
        runs.delete(input.requestId)
      }
      return { ok: Boolean(run) }
    }),

  cancel: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.cancel()
      runs.delete(input.requestId)
      return { ok: Boolean(run) }
    }),
})
