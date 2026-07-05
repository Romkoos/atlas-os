// src/main/trpc/routers/benchmarkChat.ts
import { db } from '@main/db/client'
import { benchmarkAnalysis } from '@main/db/schema'
import { buildChatSeed } from '@main/services/benchmarkChat/seed'
import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { BenchmarkChatEvent, SeqEnvelope } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { eq } from 'drizzle-orm'
import { app } from 'electron'
import { z } from 'zod'

const CHAT_TOOLS = ['Read', 'Grep', 'Glob']

// Rebuild the discussion seed from stored benchmark data. Returns undefined
// when the batch has no analysis row (surface an error instead of a blank chat).
function seedForBatch(batchId: string): string | undefined {
  const analysis = db()
    .select()
    .from(benchmarkAnalysis)
    .where(eq(benchmarkAnalysis.batchId, batchId))
    .get()
  return analysis ? buildChatSeed(analysis.summary, analysis.dataJson) : undefined
}

export const benchmarkChatRouter = router({
  open: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        lastSeq: z.number().int().nonnegative(),
        // kickoff is the batchId for a brand-new discussion; absent on resume.
        kickoff: z.string().min(1).optional(),
        continueWork: z.boolean().optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<BenchmarkChatEvent>>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const repoRoot = app.getAppPath()
        return chatRegistry.open(
          {
            sessionId: input.sessionId,
            lastSeq: input.lastSeq,
            kickoff: input.kickoff,
            resumable: true,
            continueWork: input.continueWork,
            continuationKind: 'plain',
            buildRun: ({ resume, kickoff, resumeMessage, push }) => {
              const job = jobRegistry.register({
                kind: 'benchmark.chat',
                label: 'Benchmark chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              })
              let seed: string | undefined
              if (kickoff) {
                seed = seedForBatch(kickoff)
                if (!seed) {
                  push({ type: 'error', message: 'No analysis found for this batch' })
                  job.finish('error')
                  return {
                    reply: () => {},
                    cancel: () => {},
                    dispose: () => {},
                    done: Promise.resolve(),
                  }
                }
              }
              return startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd: repoRoot,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                seed,
                resume,
                resumeMessage,
                onRateLimit: (info) => subscriptionUsage.updateFromEvent(info, Date.now()),
                emit: (event) => {
                  if (event.type === 'done') job.finish('done')
                  if (event.type === 'error' || event.type === 'aborted') job.finish('error')
                  push(event)
                },
              })
            },
          },
          (env) => emit.next(env as SeqEnvelope<BenchmarkChatEvent>),
        )
      }),
    ),

  reply: publicProcedure
    .input(z.object({ sessionId: z.string().uuid(), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.reply(input.sessionId, input.text) })),

  cancel: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.cancel(input.sessionId) })),
})
