import { db } from '@main/db/client'
import { events } from '@main/db/schema'
import { logger } from '@main/logger'
import { type ClaudeRun, runClaude } from '@main/services/claude'
import { revealInFinder, saveMarkdown } from '@main/services/files'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { AgentEvent } from '@shared/ipc-events'
import { CLAUDE_MODEL_IDS } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

// Active runs keyed by requestId, so an explicit cancel can stop them.
const runs = new Map<string, ClaudeRun>()

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
        const startedAt = Date.now()
        let cancelled = false
        const settings = getSettings()

        const run = runClaude({
          prompt: input.prompt,
          model: input.model,
          onToken: (text) => emit.next({ type: 'token', text }),
        })
        runs.set(input.requestId, run)

        run.done
          .then(async (result) => {
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
          })
          .catch((error) => {
            if (cancelled) {
              emit.next({ type: 'aborted' })
              emit.complete()
              return
            }
            const message = error instanceof Error ? error.message : 'Unknown error'
            logger.error('Agent run failed', message)
            emit.next({ type: 'error', message })
            emit.complete()
          })
          .finally(() => {
            runs.delete(input.requestId)
          })

        // Teardown on unsubscribe (the renderer's cancel path).
        return () => {
          cancelled = true
          run.cancel()
          runs.delete(input.requestId)
        }
      }),
    ),

  cancel: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = runs.get(input.requestId)
      run?.cancel()
      return { ok: Boolean(run) }
    }),

  openFile: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      revealInFinder(input.path)
      return { ok: true }
    }),
})
