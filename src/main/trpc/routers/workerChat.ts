import { logger } from '@main/logger'
import { repoRoot } from '@main/paths'
import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { clearDevBinding, getDevBinding, updateRoadmapItem } from '@main/services/roadmap/store'
import { buildWorkerChatSeed } from '@main/services/workerChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { SeqEnvelope, WorkerChatEvent } from '@shared/ipc-events'
import { CLAUDE_MODEL_IDS, DEFAULT_MODEL_ID } from '@shared/models'
import { parseDeploySentinel } from '@shared/roadmap'
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
        // Autonomous end-to-end mode: authorizes the worker to commit/push/merge/
        // deploy without confirmation. Threaded into the seed directive. Fixed per
        // session (mirrors `model`); the seed only carries it on the fresh kickoff.
        autonomous: z.boolean().optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<WorkerChatEvent>>((emit) => {
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
            // One job for the whole session; the registry finishes it on
            // finalize/cancel, so auto-continues never orphan a running job.
            registerJob: () =>
              jobRegistry.register({
                kind: 'worker.chat',
                label: 'Worker chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              }),
            buildRun: ({ resume, kickoff, resumeMessage, push }) => {
              let flipped = false
              // Separate one-shot guard for the error toast: the flip itself is only
              // marked done on success, so a transient failure retries on the next
              // onAssistantText/onTurnComplete callback (the sentinel stays in
              // `accumulated`); this guard just keeps a persistent failure from
              // spamming the user with a duplicate error on every retry.
              let flipErrored = false
              const checkDeployed = (accumulated: string) => {
                if (flipped) return
                if (!parseDeploySentinel(accumulated)) return
                const binding = getDevBinding()
                if (binding?.phase !== 'building') return
                try {
                  updateRoadmapItem({ id: binding.itemId, status: 'done' })
                  clearDevBinding()
                  push({ type: 'deployed', itemId: binding.itemId })
                  flipped = true
                } catch (error) {
                  logger.error(
                    'Dev deploy flip failed',
                    error instanceof Error ? error.message : String(error),
                  )
                  if (!flipErrored) {
                    flipErrored = true
                    push({
                      type: 'error',
                      message:
                        'Deploy succeeded but marking the roadmap item done failed — set it to done manually.',
                    })
                  }
                }
              }
              return startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                seed: kickoff
                  ? buildWorkerChatSeed(kickoff, { autonomous: input.autonomous })
                  : undefined,
                resume,
                resumeMessage,
                onRateLimit: (info) => subscriptionUsage.updateFromEvent(info, Date.now()),
                emit: (event) => push(event),
                onAssistantText: (_delta, accumulated) => checkDeployed(accumulated),
                onTurnComplete: (accumulated) => checkDeployed(accumulated),
              })
            },
          },
          (env) => emit.next(env as SeqEnvelope<WorkerChatEvent>),
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
