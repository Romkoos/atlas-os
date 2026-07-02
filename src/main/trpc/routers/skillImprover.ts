import { db } from '@main/db/client'
import { events } from '@main/db/schema'
import { logger } from '@main/logger'
import { chatRegistry } from '@main/services/chat/registry'
import { jobRegistry } from '@main/services/jobs/registry'
import { startImproverRun } from '@main/services/skillImprover'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { ImproverEvent, SeqEnvelope } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

// accept/reject finalize the improver's transactional workspace; the registry
// only stores a ResumableRun, so hold these controls separately per session.
const improverControls = new Map<string, { accept: () => Promise<void>; reject: () => Promise<void> }>()

export const skillImproverRouter = router({
  open: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        lastSeq: z.number().int().nonnegative(),
        // kickoff is the skillId for a brand-new run; absent on (blocked) resume.
        kickoff: z.string().min(1).optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<ImproverEvent>>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        return chatRegistry.open(
          {
            sessionId: input.sessionId,
            lastSeq: input.lastSeq,
            kickoff: input.kickoff,
            // The improver owns a transactional workspace torn down on finalize;
            // it cannot be safely resumed after a full app restart.
            resumable: false,
            buildRun: ({ kickoff, push }) => {
              const skillId = kickoff as string // resumable:false blocks build without kickoff
              const job = jobRegistry.register({
                kind: 'skill.improve',
                label: 'Skill improver',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              })
              const run = startImproverRun({
                requestId: input.sessionId,
                skillId,
                model,
                emit: (event) => {
                  // Record a stats event when the session ends (applied or reverted).
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
                      skillId,
                      applied: event.type === 'done',
                      tokens: event.tokens,
                      durationMs: event.durationMs,
                    })
                    job.finish(event.type === 'done' ? 'done' : 'error', { tokens: event.tokens })
                  }
                  if (event.type === 'error') job.finish('error')
                  push(event)
                },
              })
              improverControls.set(input.sessionId, { accept: run.accept, reject: run.reject })
              return {
                reply: run.reply,
                cancel: run.cancel,
                done: run.done.finally(() => improverControls.delete(input.sessionId)),
              }
            },
          },
          (env) => emit.next(env as SeqEnvelope<ImproverEvent>),
        )
      }),
    ),

  reply: publicProcedure
    .input(z.object({ sessionId: z.string().uuid(), text: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: chatRegistry.reply(input.sessionId, input.text) })),

  accept: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      const controls = improverControls.get(input.sessionId)
      if (controls) {
        await controls.accept()
        improverControls.delete(input.sessionId)
      }
      return { ok: Boolean(controls) }
    }),

  reject: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      const controls = improverControls.get(input.sessionId)
      if (controls) {
        await controls.reject()
        improverControls.delete(input.sessionId)
      }
      return { ok: Boolean(controls) }
    }),

  cancel: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      improverControls.delete(input.sessionId)
      return { ok: chatRegistry.cancel(input.sessionId) }
    }),
})
