// src/main/trpc/routers/benchmarkChat.ts
import { db } from '@main/db/client'
import { benchmarkAnalysis } from '@main/db/schema'
import { repoRoot } from '@main/paths'
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
        const cwd = repoRoot()
        // A fresh discussion needs its batch analysis on disk. Validate up front so
        // we never open a session (or register a job) for a batch with no analysis.
        const seed = input.kickoff ? seedForBatch(input.kickoff) : undefined
        if (input.kickoff && !seed) {
          emit.next({
            seq: 1,
            event: { type: 'error', message: 'No analysis found for this batch' },
          })
          return () => {}
        }
        return chatRegistry.open(
          {
            sessionId: input.sessionId,
            lastSeq: input.lastSeq,
            kickoff: input.kickoff,
            resumable: true,
            continueWork: input.continueWork,
            continuationKind: 'plain',
            // One job for the whole session; the registry finishes it on
            // finalize/cancel, so auto-continues never orphan a running job.
            registerJob: () =>
              jobRegistry.register({
                kind: 'benchmark.chat',
                label: 'Benchmark chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              }),
            buildRun: ({ resume, kickoff, resumeMessage, push }) =>
              startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                // seed only applies to the fresh run (kickoff present); resumes idle.
                seed: kickoff ? seed : undefined,
                resume,
                resumeMessage,
                onRateLimit: (info) => subscriptionUsage.updateFromEvent(info, Date.now()),
                emit: (event) => push(event),
              }),
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
