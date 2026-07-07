import { repoRoot } from '@main/paths'
import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { buildGeneralChatSeed } from '@main/services/generalChat/seed'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { BaseChatEvent, SeqEnvelope } from '@shared/ipc-events'
import { CLAUDE_MODEL_IDS, DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

const CHAT_TOOLS = ['Read', 'Grep', 'Glob']

export const generalChatRouter = router({
  open: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        lastSeq: z.number().int().nonnegative(),
        kickoff: z.string().min(1).optional(),
        continueWork: z.boolean().optional(),
        model: z.enum(CLAUDE_MODEL_IDS).optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<BaseChatEvent>>((emit) => {
        const model = input.model ?? getSettings().model ?? DEFAULT_MODEL_ID
        const cwd = repoRoot()
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
                kind: 'general.chat',
                label: 'General chat',
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
                seed: kickoff ? buildGeneralChatSeed(kickoff) : undefined,
                resume,
                resumeMessage,
                onRateLimit: (info) => subscriptionUsage.updateFromEvent(info, Date.now()),
                emit: (event) => push(event),
              }),
          },
          (env) => emit.next(env as SeqEnvelope<BaseChatEvent>),
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
