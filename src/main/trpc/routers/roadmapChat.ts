import { logger } from '@main/logger'
import { jobRegistry } from '@main/services/jobs/registry'
import { createRoadmapItem, listRoadmap } from '@main/services/roadmap/store'
import { type RoadmapChatRun, startRoadmapChat } from '@main/services/roadmapChat/run'
import { buildRoadmapChatSeed } from '@main/services/roadmapChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { RoadmapChatEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { app } from 'electron'
import { z } from 'zod'

const runs = new Map<string, RoadmapChatRun>()

export const roadmapChatRouter = router({
  start: publicProcedure
    .input(z.object({ requestId: z.string().min(1), idea: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<RoadmapChatEvent>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const seed = buildRoadmapChatSeed(input.idea, listRoadmap())
        const job = jobRegistry.register({
          kind: 'roadmap.chat',
          label: 'Roadmap idea chat',
          model,
          abort: () => runs.get(input.requestId)?.cancel(),
        })

        const run = startRoadmapChat({
          requestId: input.requestId,
          seed,
          model,
          repoRoot: app.getAppPath(),
          onProposal: (proposal) => {
            try {
              const item = createRoadmapItem(proposal)
              logger.info('Roadmap idea saved from chat', { id: item.id, title: item.title })
              emit.next({ type: 'saved', item })
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Failed to save idea'
              logger.error('Roadmap idea save failed', message)
              emit.next({ type: 'error', message })
            }
          },
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
