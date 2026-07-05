import { repoRoot } from '@main/paths'
import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { buildWorkerChatSeed } from '@main/services/workerChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { BaseChatEvent, SeqEnvelope } from '@shared/ipc-events'
import { CLAUDE_MODEL_IDS, DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

// Full-power worker: can modify the repo (bypassPermissions at repo root).
const CHAT_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'TodoWrite']

export const workerChatRouter = router({
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
            continuationKind: 'worker',
            buildRun: ({ resume, kickoff, resumeMessage, push }) => {
              const job = jobRegistry.register({
                kind: 'worker.chat',
                label: 'Worker chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              })
              return startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                seed: kickoff ? buildWorkerChatSeed(kickoff) : undefined,
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
