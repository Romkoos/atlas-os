import { appPaths } from '@main/paths'
import { readJsonlFile } from '@main/services/productivity/jsonl'
import { buildTranscriptTimeline } from '@main/services/timeline/buildTranscriptTimeline'
import { locateTranscript } from '@main/services/timeline/locateTranscript'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { SessionTimeline } from '@shared/timeline'
import { z } from 'zod'

export const timelineRouter = router({
  // Replay: reconstruct a finished session's timeline from its on-disk transcript.
  get: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }): Promise<SessionTimeline> => {
      const file = await locateTranscript(appPaths().claudeProjectsDir, input.sessionId)
      if (!file) {
        return {
          sessionId: input.sessionId,
          startMs: 0,
          endMs: null,
          spans: [],
          tokens: [],
          source: 'transcript',
        }
      }
      const lines = await readJsonlFile(file)
      return buildTranscriptTimeline(input.sessionId, lines)
    }),
})
