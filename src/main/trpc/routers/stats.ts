import { db } from '@main/db/client'
import { events } from '@main/db/schema'
import { fillDailySeries } from '@main/services/stats'
import { publicProcedure, router } from '@main/trpc/trpc'
import { avg, count, gte, max, sql } from 'drizzle-orm'
import { z } from 'zod'

const DAYS = 30

export const statsRouter = router({
  summary: publicProcedure
    .output(
      z.object({
        total: z.number(),
        avgDurationMs: z.number(),
        avgTokens: z.number(),
        lastRun: z.date().nullable(),
      }),
    )
    .query(() => {
      const row = db()
        .select({
          total: count(),
          avgDuration: avg(events.durationMs),
          avgTokens: avg(events.tokens),
          lastRun: max(events.createdAt),
        })
        .from(events)
        .get()

      return {
        total: row?.total ?? 0,
        avgDurationMs: Math.round(Number(row?.avgDuration ?? 0)),
        avgTokens: Math.round(Number(row?.avgTokens ?? 0)),
        lastRun: row?.lastRun ?? null,
      }
    }),

  daily: publicProcedure
    .output(z.array(z.object({ date: z.string(), count: z.number() })))
    .query(() => {
      const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)
      const day = sql<string>`date(${events.createdAt} / 1000, 'unixepoch', 'localtime')`
      const rows = db()
        .select({ day, count: count() })
        .from(events)
        .where(gte(events.createdAt, cutoff))
        .groupBy(day)
        .all()

      return fillDailySeries(rows, DAYS, new Date())
    }),
})
