// src/main/trpc/routers/benchmark.ts
import { randomUUID } from 'node:crypto'
import { db } from '@main/db/client'
import { benchmarkAnalysis, benchmarkRuns } from '@main/db/schema'
import { buildAbSlice, rowToRawRun, summarizeRuns } from '@main/services/benchmark/aggregate'
import { runAnalysis } from '@main/services/benchmark/analysis'
import { getLatest, getProgress, startBatch } from '@main/services/benchmark/batch'
import {
  clearCompareBaseline,
  getInfraCompareData,
  wipeBenchmarkRuns,
} from '@main/services/benchmark/compare'
import { summarize, type TaskInfraSummary } from '@main/services/benchmark/stats'
import { TASKS } from '@main/services/benchmark/tasks'
import { publicProcedure, router } from '@main/trpc/trpc'
import { desc } from 'drizzle-orm'
import { app } from 'electron'
import { z } from 'zod'

const deltaShape = z.object({
  taskId: z.string(),
  before: z.number(),
  after: z.number(),
  absDelta: z.number(),
  pctDelta: z.number(),
})

const abRowShape = z.object({
  taskId: z.string(),
  beforeInfraHash: z.string(),
  afterInfraHash: z.string(),
  tokens: deltaShape,
  output: deltaShape,
  cost: deltaShape,
})

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

  latestAnalysis: publicProcedure
    .output(
      z
        .object({
          batchId: z.string(),
          createdAt: z.number(),
          model: z.string(),
          summary: z.string().nullable(),
          dataJson: z.array(abRowShape),
        })
        .nullable(),
    )
    .query(() => {
      const row = db()
        .select()
        .from(benchmarkAnalysis)
        .orderBy(desc(benchmarkAnalysis.createdAt))
        .limit(1)
        .get()
      if (!row) return null
      return {
        batchId: row.batchId,
        createdAt: row.createdAt.getTime(),
        model: row.model,
        summary: row.summary,
        dataJson: row.dataJson,
      }
    }),

  // Recompute the analysis from current data and persist a fresh row. Used by
  // the "analysis unavailable" retry button. Scoped to the card's batchId so
  // the inserted row is always labeled with the correct batch/infraHash pair.
  // The A/B slice is computed globally (all runs) — it compares the latest infra
  // variant vs the previous one regardless of which batch triggered the retry.
  reanalyze: publicProcedure
    .input(z.object({ batchId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(async ({ input }) => {
      const rows = db().select().from(benchmarkRuns).all()
      const batchRows = rows.filter((r) => r.batchId === input.batchId)
      if (batchRows.length === 0) return { ok: false }
      const newest = batchRows.reduce((a, b) => (a.ts.getTime() >= b.ts.getTime() ? a : b))
      const slice = buildAbSlice(summarizeRuns(rows.map(rowToRawRun)))
      const summary =
        slice.length > 0
          ? await runAnalysis({ slice, model: newest.model, repoRoot: app.getAppPath() })
          : null
      db()
        .insert(benchmarkAnalysis)
        .values({
          id: randomUUID(),
          batchId: input.batchId,
          createdAt: new Date(),
          model: newest.model,
          infraHash: newest.infraHash,
          baselineInfraHash: slice[0]?.beforeInfraHash ?? null,
          summary,
          dataJson: slice,
        })
        .run()
      return { ok: summary !== null }
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
