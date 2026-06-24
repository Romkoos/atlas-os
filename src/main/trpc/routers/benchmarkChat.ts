// src/main/trpc/routers/benchmarkChat.ts
import { db } from '@main/db/client'
import { benchmarkAnalysis } from '@main/db/schema'
import { logger } from '@main/logger'
import { type BenchmarkChatRun, startBenchmarkChat } from '@main/services/benchmarkChat/run'
import { buildChatSeed } from '@main/services/benchmarkChat/seed'
import { jobRegistry } from '@main/services/jobs/registry'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { BenchmarkChatEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { app } from 'electron'
import { z } from 'zod'

const runs = new Map<string, BenchmarkChatRun>()

export const benchmarkChatRouter = router({
  start: publicProcedure
    .input(z.object({ requestId: z.string().min(1), batchId: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<BenchmarkChatEvent>((emit) => {
        const analysis = db()
          .select()
          .from(benchmarkAnalysis)
          .where(eq(benchmarkAnalysis.batchId, input.batchId))
          .get()
        if (!analysis) {
          emit.next({ type: 'error', message: 'No analysis found for this batch' })
          emit.complete()
          return
        }
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const seed = buildChatSeed(analysis.summary, analysis.dataJson)
        const job = jobRegistry.register({
          kind: 'benchmark.chat',
          label: 'Benchmark chat',
          abort: () => runs.get(input.requestId)?.cancel(),
        })
        const run = startBenchmarkChat({
          requestId: input.requestId,
          seed,
          model,
          repoRoot: app.getAppPath(),
          emit: (event) => {
            if (event.type === 'error' || event.type === 'aborted') {
              logger.info('Benchmark chat ended', { type: event.type })
            }
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
