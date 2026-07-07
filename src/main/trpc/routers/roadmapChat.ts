import { db } from '@main/db/client'
import { logger } from '@main/logger'
import { repoRoot } from '@main/paths'
import { chatRegistry } from '@main/services/chat/registry'
import { startResumableChat } from '@main/services/chat/resumableRun'
import { subscriptionUsage } from '@main/services/chat/subscriptionUsage'
import { getSubgraphContext } from '@main/services/graph/context'
import { loadGraph } from '@main/services/graph/store'
import { jobRegistry } from '@main/services/jobs/registry'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { createRoadmapItem, listRoadmap } from '@main/services/roadmap/store'
import { buildRoadmapChatSeed } from '@main/services/roadmapChat/seed'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { RoadmapChatEvent, SeqEnvelope } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { parseRoadmapProposal } from '@shared/roadmap'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

const CHAT_TOOLS = ['Read', 'Grep', 'Glob']

export const roadmapChatRouter = router({
  open: publicProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        lastSeq: z.number().int().nonnegative(),
        kickoff: z.string().min(1).optional(),
        continueWork: z.boolean().optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<SeqEnvelope<RoadmapChatEvent>>((emit) => {
        const model = getSettings().model ?? DEFAULT_MODEL_ID
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
                kind: 'roadmap.chat',
                label: 'Roadmap idea chat',
                model,
                abort: () => chatRegistry.cancel(input.sessionId),
              }),
            buildRun: ({ resume, kickoff, resumeMessage, push }) => {
              let saved = false
              const checkProposal = (accumulated: string) => {
                if (saved) return
                const proposal = parseRoadmapProposal(accumulated)
                if (!proposal) return
                saved = true
                try {
                  const item = createRoadmapItem(proposal)
                  logger.info('Roadmap idea saved from chat', { id: item.id, title: item.title })
                  push({ type: 'saved', item })
                } catch (error) {
                  const message = error instanceof Error ? error.message : 'Failed to save idea'
                  logger.error('Roadmap idea save failed', message)
                  push({ type: 'error', message })
                }
              }
              let seed: string | undefined
              if (kickoff) {
                const graphContext = getSubgraphContext(loadGraph(db(), cwd), {
                  query: kickoff,
                  depth: 1,
                  budget: 1000,
                })
                const baseSeed = buildRoadmapChatSeed(kickoff, listRoadmap())
                seed = graphContext ? `${baseSeed}\n\n${graphContext}` : baseSeed
              }
              return startResumableChat({
                sessionId: input.sessionId,
                model,
                cwd,
                allowedTools: CHAT_TOOLS,
                settingSources: ['user', 'project'],
                env: subscriptionEnv(),
                seed,
                resume,
                resumeMessage,
                onRateLimit: (info) => subscriptionUsage.updateFromEvent(info, Date.now()),
                emit: (event) => push(event),
                onAssistantText: (_delta, accumulated) => checkProposal(accumulated),
                onTurnComplete: (accumulated) => checkProposal(accumulated),
              })
            },
          },
          (env) => emit.next(env as SeqEnvelope<RoadmapChatEvent>),
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
