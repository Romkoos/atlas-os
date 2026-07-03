import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { buildWorkerChatSeed } from '@main/services/workerChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { BaseChatEvent, SeqEnvelope } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { app } from 'electron'
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
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<BaseChatEvent>>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const repoRoot = app.getAppPath()
        return chatRegistry.open(
          {
            sessionId: input.sessionId,
            lastSeq: input.lastSeq,
            kickoff: input.kickoff,
            resumable: true,
            buildRun: ({ resume, kickoff, push }) => {
              const job = jobRegistry.register({
                kind: 'worker.chat',
                label: 'Worker chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              })
              return startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd: repoRoot,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                seed: kickoff ? buildWorkerChatSeed(kickoff) : undefined,
                resume,
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
