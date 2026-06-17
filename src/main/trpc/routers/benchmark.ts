// src/main/trpc/routers/benchmark.ts
import { db } from '@main/db/client'
import { benchmarkRuns } from '@main/db/schema'
import { getLatest, getProgress, startBatch } from '@main/services/benchmark/batch'
import {
  clearCompareBaseline,
  getInfraCompareData,
  wipeBenchmarkRuns,
} from '@main/services/benchmark/compare'
import { summarize, type TaskInfraSummary } from '@main/services/benchmark/stats'
import { TASKS } from '@main/services/benchmark/tasks'
import { publicProcedure, router } from '@main/trpc/trpc'
import { z } from 'zod'

// Shape for InfraState — matches src/main/services/productivity/infra.ts.
// Kept inline (rather than importing) because tRPC output schemas must be Zod
// values, and the InfraState interface is a pure TS type.
const infraStateShape = z.object({
  plugins: z.record(z.string(), z.boolean()),
  mcpActive: z.array(z.string()),
  mcpDisabled: z.array(z.string()),
  skills: z.record(z.string(), z.number()),
})

const infraSnapshotShape = z.object({
  ts: z.number(),
  batchId: z.string(),
  state: infraStateShape,
})

const progressShape = z
  .object({
    batchId: z.string(),
    total: z.number(),
    done: z.number(),
    failed: z.number(),
    running: z.boolean(),
    phase: z.enum(['running', 'retrying', 'analyzing', 'done']),
    error: z.string().nullable(),
  })
  .nullable()

export const benchmarkRouter = router({
  tasks: publicProcedure
    .output(
      z.array(
        z.object({
          id: z.string(),
          prompt: z.string(),
          name: z.string().nullable(),
          description: z.string().nullable(),
          category: z.string().nullable(),
        }),
      ),
    )
    .query(() =>
      TASKS.map((t) => ({
        id: t.id,
        prompt: t.prompt,
        name: t.name ?? null,
        description: t.description ?? null,
        category: t.category ?? null,
      })),
    ),

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
          // Human label + description + category for the task row (denormalized
          // from the TASKS fixture so the UI doesn't need a separate join).
          name: z.string().nullable(),
          description: z.string().nullable(),
          category: z.string().nullable(),
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
        name: string | null
        description: string | null
        category: string | null
      })[] = []
      const taskMeta = new Map(TASKS.map((t) => [t.id, t]))
      for (const g of groups.values()) {
        const snap = g[0].infraSnapshot
        const meta = taskMeta.get(g[0].taskId)
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
          name: meta?.name ?? null,
          description: meta?.description ?? null,
          category: meta?.category ?? null,
        })
      }
      return summaries
    }),

  // Infra compare: prev = second-most-recent batch's snapshot, last = newest
  // batch's snapshot, live = live-from-disk infra. Rows with ts <= baseline
  // cleared marker are skipped so "Clear" effectively resets the pair without
  // deleting historical runs from the results table.
  infraCompare: publicProcedure
    .output(
      z.object({
        prev: infraSnapshotShape.nullable(),
        last: infraSnapshotShape.nullable(),
        live: infraStateShape,
        baselineClearedAt: z.number().nullable(),
      }),
    )
    .query(() => getInfraCompareData()),

  // Reset the compare pair pointer. Existing benchmark_runs rows are preserved
  // (still visible in the results table); they're just filtered out of the
  // compare panel until newer runs land.
  clearCompareBaseline: publicProcedure
    .output(z.object({ clearedAt: z.number() }))
    .mutation(() => clearCompareBaseline()),

  // Destructive: deletes ALL benchmark_runs rows AND the baseline marker. UI
  // must confirm before invoking. Returns number of rows deleted.
  wipeRuns: publicProcedure
    .output(z.object({ deleted: z.number() }))
    .mutation(() => wipeBenchmarkRuns()),
})
