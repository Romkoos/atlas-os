import { db } from '@main/db/client'
import { events } from '@main/db/schema'
import { logger } from '@main/logger'
import { streamCompletion } from '@main/services/anthropic'
import { revealInFinder, saveMarkdown } from '@main/services/files'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { AgentEvent } from '@shared/ipc-events'
import { CLAUDE_MODEL_IDS } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

// Active runs keyed by requestId, so an explicit cancel can abort them.
const aborts = new Map<string, AbortController>()

export const agentRouter = router({
  run: publicProcedure
    .input(
      z.object({
        requestId: z.string().min(1),
        prompt: z.string().min(1),
        model: z.enum(CLAUDE_MODEL_IDS),
      }),
    )
    .subscription(({ input }) =>
      observable<AgentEvent>((emit) => {
        const controller = new AbortController()
        aborts.set(input.requestId, controller)
        const startedAt = Date.now()

        const run = async () => {
          try {
            const settings = getSettings()
            const result = await streamCompletion({
              prompt: input.prompt,
              model: input.model,
              signal: controller.signal,
              onToken: (text) => emit.next({ type: 'token', text }),
            })

            const durationMs = Date.now() - startedAt
            const filePath = await saveMarkdown(settings.outputDir, result.text, {
              model: input.model,
              prompt: input.prompt,
              tokens: result.outputTokens,
              createdAt: new Date(),
            })

            db()
              .insert(events)
              .values({
                type: 'agent.run',
                model: input.model,
                tokens: result.outputTokens,
                filePath,
                durationMs,
              })
              .run()

            logger.info('Agent run saved', {
              tokens: result.outputTokens,
              durationMs,
              filePath,
            })
            emit.next({ type: 'done', filePath, tokens: result.outputTokens, durationMs })
            emit.complete()
          } catch (error) {
            if (controller.signal.aborted) {
              emit.next({ type: 'aborted' })
              emit.complete()
              return
            }
            const message = error instanceof Error ? error.message : 'Unknown error'
            logger.error('Agent run failed', message)
            emit.next({ type: 'error', message })
            emit.complete()
          } finally {
            aborts.delete(input.requestId)
          }
        }

        void run()

        // Teardown when the renderer unsubscribes (also our cancel path).
        return () => {
          controller.abort()
          aborts.delete(input.requestId)
        }
      }),
    ),

  cancel: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const controller = aborts.get(input.requestId)
      controller?.abort()
      return { ok: Boolean(controller) }
    }),

  openFile: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      revealInFinder(input.path)
      return { ok: true }
    }),
})
