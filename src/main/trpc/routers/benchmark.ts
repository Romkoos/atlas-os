// src/main/trpc/routers/benchmark.ts
import { db } from '@main/db/client'
import { benchmarkRuns } from '@main/db/schema'
import { getLatest, getProgress, startBatch } from '@main/services/benchmark/batch'
import { summarize, type TaskInfraSummary } from '@main/services/benchmark/stats'
import { TASKS } from '@main/services/benchmark/tasks'
import { publicProcedure, router } from '@main/trpc/trpc'
import { z } from 'zod'

const progressShape = z
  .object({
    batchId: z.string(),
    total: z.number(),
    done: z.number(),
    failed: z.number(),
    running: z.boolean(),
    error: z.string().nullable(),
  })
  .nullable()

export const benchmarkRouter = router({
  tasks: publicProcedure
    .output(z.array(z.object({ id: z.string(), prompt: z.string() })))
    .query(() => TASKS.map((t) => ({ id: t.id, prompt: t.prompt }))),

  run: publicProcedure
    .input(
      z.object({
        taskIds: z.array(z.string()).optional(),
        k: z.number().int().min(1).max(20).default(5),
        model: z.string().default('claude-sonnet-4-6'),
      }),
    )
    .output(z.object({ batchId: z.string(), total: z.number() }))
    .mutation(({ input }) => startBatch(input)),

  progress: publicProcedure
    .input(z.object({ batchId: z.string() }))
    .output(progressShape)
    .query(({ input }) => getProgress(input.batchId)),

  // Most recent batch in memory, so the UI can re-attach progress after the tab
  // remounts. Null after an app restart (results still come from `results`).
  latest: publicProcedure.output(progressShape).query(() => getLatest()),

  results: publicProcedure
    .output(
      z.array(
        z.object({
          taskId: z.string(),
          infraHash: z.string(),
          model: z.string(),
          n: z.number(),
          medianTokens: z.number(),
          spreadTokens: z.number(),
          medianCacheTokens: z.number(),
          medianOutputTokens: z.number(),
          medianCostUsd: z.number(),
          // Context to make a bare infra hash legible in the UI.
          firstTs: z.number(), // earliest run in this group (ms)
          plugins: z.number(), // enabled plugins at run time
          mcp: z.number(), // active MCP servers
          skills: z.number(), // user skills present
        }),
      ),
    )
    .query(() => {
      const rows = db().select().from(benchmarkRuns).all()
      const groups = new Map<string, typeof rows>()
      for (const r of rows) {
        const key = `${r.taskId}::${r.infraHash}::${r.model}`
        const arr = groups.get(key) ?? []
        arr.push(r)
        groups.set(key, arr)
      }
      const summaries: (TaskInfraSummary & {
        model: string
        firstTs: number
        plugins: number
        mcp: number
        skills: number
      })[] = []
      for (const g of groups.values()) {
        const snap = g[0].infraSnapshot
        summaries.push({
          ...summarize(
            g[0].taskId,
            g[0].infraHash,
            g.map((r) => ({
              tokensIn: r.tokensIn,
              tokensOut: r.tokensOut,
              cacheReadTokens: r.cacheReadTokens,
              cacheCreationTokens: r.cacheCreationTokens,
              totalCostUsd: r.totalCostUsd,
              success: r.success,
            })),
          ),
          model: g[0].model,
          firstTs: Math.min(...g.map((r) => r.ts.getTime())),
          plugins: Object.values(snap.plugins).filter(Boolean).length,
          mcp: snap.mcpActive.length,
          skills: Object.keys(snap.skills).length,
        })
      }
      return summaries
    }),
})
