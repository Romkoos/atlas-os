import { publicProcedure, router } from '@main/trpc/trpc'
import { app } from 'electron'
import { z } from 'zod'

export const healthRouter = router({
  ping: publicProcedure
    .output(
      z.object({
        ok: z.boolean(),
        version: z.string(),
        pong: z.number(),
        uptimeMs: z.number(),
        memMB: z.number(),
      }),
    )
    .query(() => ({
      ok: true,
      version: app.getVersion(),
      pong: Date.now(),
      uptimeMs: Math.round(process.uptime() * 1000),
      memMB: Math.round(process.memoryUsage().rss / (1024 * 1024)),
    })),
})
