import { type GeneralChatRun, startGeneralChat } from '@main/services/generalChat/run'
import { buildGeneralChatSeed } from '@main/services/generalChat/seed'
import { jobRegistry } from '@main/services/jobs/registry'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { GeneralChatEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { app } from 'electron'
import { z } from 'zod'

const runs = new Map<string, GeneralChatRun>()

export const generalChatRouter = router({
  start: publicProcedure
    .input(z.object({ requestId: z.string().min(1), message: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<GeneralChatEvent>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const repoRoot = app.getAppPath()
        const seed = buildGeneralChatSeed(input.message)
        const job = jobRegistry.register({
          kind: 'general.chat',
          label: 'General chat',
          model,
          abort: () => runs.get(input.requestId)?.cancel(),
        })

        const run = startGeneralChat({
          requestId: input.requestId,
          seed,
          model,
          repoRoot,
          emit: (event) => {
            if (event.type === 'done') job.finish('done')
            if (event.type === 'error' || event.type === 'aborted') job.finish('error')
            emit.next(event)
          },
        })
        runs.set(input.requestId, run)

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
