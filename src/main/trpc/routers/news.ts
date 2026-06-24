import { db } from '@main/db/client'
import { events } from '@main/db/schema'
import { logger } from '@main/logger'
import { jobRegistry, trackJob } from '@main/services/jobs/registry'
import { type NewsRun, readNews, runNews } from '@main/services/news'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { NewsEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

// Active runs keyed by requestId, so an explicit cancel can stop them.
const runs = new Map<string, NewsRun>()

export const newsRouter = router({
  // Read the single overwritten digest. `updatedAt` is null when no run has
  // produced a file yet (drives the empty state on the News tab).
  read: publicProcedure
    .output(z.object({ raw: z.string(), updatedAt: z.string().nullable() }))
    .query(() => readNews()),

  // Stream the daily-ai-news skill run live. Mirrors agent.run — records an
  // events row so the run shows up in Stats — minus saveMarkdown (the skill owns
  // the file write).
  run: publicProcedure.input(z.object({ requestId: z.string().min(1) })).subscription(({ input }) =>
    observable<NewsEvent>((emit) => {
      const startedAt = Date.now()
      let cancelled = false
      const model = getSettings().model ?? DEFAULT_MODEL_ID

      const run = runNews({
        model,
        onToken: (text) => emit.next({ type: 'token', text }),
      })
      runs.set(input.requestId, run)

      // Mirror the run into the global job registry. Fire-and-forget: this router
      // already owns run.done for its own emit logic, so swallow here.
      trackJob(
        jobRegistry,
        { kind: 'news', label: 'News digest', abort: () => run.cancel() },
        run.done,
      ).catch(() => {})

      run.done
        .then((result) => {
          const durationMs = Date.now() - startedAt

          db()
            .insert(events)
            .values({
              type: 'news.run',
              model,
              tokens: result.outputTokens,
              filePath: result.filePath,
              durationMs,
            })
            .run()

          logger.info('News digest saved', {
            filePath: result.filePath,
            tokens: result.outputTokens,
            durationMs,
          })
          emit.next({ type: 'done', filePath: result.filePath })
          emit.complete()
        })
        .catch((error) => {
          if (cancelled) {
            emit.next({ type: 'aborted' })
            emit.complete()
            return
          }
          const message = error instanceof Error ? error.message : 'Unknown error'
          logger.error('News run failed', message)
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
})
