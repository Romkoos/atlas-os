// src/main/services/benchmark/batch.ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { db } from '@main/db/client'
import { benchmarkAnalysis, benchmarkRuns } from '@main/db/schema'
import { appPaths } from '@main/paths'
import { buildAbSlice, rowToRawRun, summarizeRuns } from '@main/services/benchmark/aggregate'
import { runAnalysis } from '@main/services/benchmark/analysis'
import { infraFingerprint } from '@main/services/benchmark/fingerprint'
import { repoCommit, runBenchmarkTask } from '@main/services/benchmark/runner'
import { selectTransientFailures } from '@main/services/benchmark/sweep'
import { TASKS } from '@main/services/benchmark/tasks'
import type { BenchmarkTask } from '@main/services/benchmark/types'
import { readInfraState } from '@main/services/productivity/infra'
import { eq } from 'drizzle-orm'
import { app, Notification } from 'electron'

const DEFAULT_K = 5
const DEFAULT_MODEL = 'claude-sonnet-4-6'

export interface Progress {
  batchId: string
  total: number
  done: number
  failed: number
  running: boolean
  phase: 'running' | 'retrying' | 'analyzing' | 'done'
  error: string | null
}

// In-memory progress per batch. Not pruned (manual-trigger v1, few runs); concurrent batches share the same OAuth and are unsupported.
const batches = new Map<string, Progress>()
// Most recently started batch, so the UI can re-attach its progress after the
// tab unmounts/remounts (batchId lives in React state and is lost on navigation).
// Cleared on app restart (in-memory) — that's fine, finished results live in the DB.
let latestBatchId: string | null = null

export function getProgress(batchId: string): Progress | null {
  return batches.get(batchId) ?? null
}

export function getLatest(): Progress | null {
  return latestBatchId ? (batches.get(latestBatchId) ?? null) : null
}

export interface StartOptions {
  taskIds?: string[]
  k?: number
  model?: string
}

export function startBatch(opts: StartOptions): { batchId: string; total: number } {
  const k = opts.k ?? DEFAULT_K
  const model = opts.model ?? DEFAULT_MODEL
  const tasks = opts.taskIds ? TASKS.filter((t) => opts.taskIds?.includes(t.id)) : TASKS
  const total = tasks.length * k
  const batchId = randomUUID()
  const progress: Progress = {
    batchId,
    total,
    done: 0,
    failed: 0,
    running: true,
    phase: 'running',
    error: null,
  }
  batches.set(batchId, progress)
  latestBatchId = batchId
  void runLoop(batchId, tasks, k, model, progress)
  return { batchId, total }
}

async function runLoop(
  batchId: string,
  tasks: BenchmarkTask[],
  k: number,
  model: string,
  progress: Progress,
): Promise<void> {
  try {
    const repoRoot = app.getAppPath()
    const commit = repoCommit(repoRoot)
    const p = appPaths()
    const infra = await readInfraState({
      settingsPath: join(p.claudeDir, 'settings.json'),
      claudeJsonPath: p.claudeJson,
      skillsDir: join(p.claudeDir, 'skills'),
    })
    const infraHash = infraFingerprint(infra)

    for (const task of tasks) {
      for (let rep = 0; rep < k; rep++) {
        // One free retry on TRANSIENT SDK failures (controller-aborted mid-
        // session, networking blip, internal SDK error). assertion_failed and
        // rate_limited are NOT retried — they're real signals about the run.
        // This trades a small token spend for stability: a single SDK hiccup
        // shouldn't poison the batch row.
        let result = await runBenchmarkTask(task, { model, repoRoot })
        if (
          !result.success &&
          (result.failReason === 'sdk_error' || result.failReason === 'timeout')
        ) {
          console.warn(
            `[benchmark] ${task.id} rep=${rep} transient ${result.failReason} — retrying once`,
          )
          result = await runBenchmarkTask(task, { model, repoRoot })
        }
        db()
          .insert(benchmarkRuns)
          .values({
            id: randomUUID(),
            batchId,
            ts: new Date(),
            taskId: task.id,
            rep,
            infraHash,
            infraSnapshot: infra,
            repoCommit: commit,
            model,
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            cacheReadTokens: result.cacheReadTokens,
            cacheCreationTokens: result.cacheCreationTokens,
            totalCostUsd: result.totalCostUsd,
            numTurns: result.numTurns,
            durationMs: result.durationMs,
            success: result.success,
            failReason: result.failReason,
            transcriptPath: result.sessionId,
          })
          .run()
        progress.done += 1
        if (!result.success) progress.failed += 1
      }
    }
    // Retry sweep: transient failures already got one inline retry; give them a
    // single final attempt now that the run is otherwise done (a transient blip
    // may have cleared). REPLACE the row in place so k stays clean.
    progress.phase = 'retrying'
    const tasksById = new Map(tasks.map((t) => [t.id, t]))
    const failedRows = db()
      .select()
      .from(benchmarkRuns)
      .where(eq(benchmarkRuns.batchId, batchId))
      .all()
    for (const row of selectTransientFailures(failedRows)) {
      const task = tasksById.get(row.taskId)
      if (!task) continue
      const retry = await runBenchmarkTask(task, { model, repoRoot })
      db()
        .update(benchmarkRuns)
        .set({
          ts: new Date(),
          tokensIn: retry.tokensIn,
          tokensOut: retry.tokensOut,
          cacheReadTokens: retry.cacheReadTokens,
          cacheCreationTokens: retry.cacheCreationTokens,
          totalCostUsd: retry.totalCostUsd,
          numTurns: retry.numTurns,
          durationMs: retry.durationMs,
          success: retry.success,
          failReason: retry.failReason,
          transcriptPath: retry.sessionId,
        })
        .where(eq(benchmarkRuns.id, row.id))
        .run()
    }
    // Recompute failed count after the sweep.
    progress.failed = db()
      .select()
      .from(benchmarkRuns)
      .where(eq(benchmarkRuns.batchId, batchId))
      .all()
      .filter((r) => !r.success).length
    // Auto-analysis: explain the A/B effect of this infra change in 2-3 plain
    // sentences. Isolated try/catch — a failed analysis must NOT mark the batch
    // errored; we persist a null-summary row instead so the UI can offer retry.
    progress.phase = 'analyzing'
    try {
      const allRows = db().select().from(benchmarkRuns).all()
      const slice = buildAbSlice(summarizeRuns(allRows.map(rowToRawRun)))
      const summary = slice.length > 0 ? await runAnalysis({ slice, model, repoRoot }) : null
      db()
        .insert(benchmarkAnalysis)
        .values({
          id: randomUUID(),
          batchId,
          createdAt: new Date(),
          model,
          infraHash,
          baselineInfraHash: slice[0]?.beforeInfraHash ?? null,
          summary,
          dataJson: slice,
        })
        .run()
    } catch (err) {
      console.error('[benchmark] analysis step failed:', err)
      db()
        .insert(benchmarkAnalysis)
        .values({
          id: randomUUID(),
          batchId,
          createdAt: new Date(),
          model,
          infraHash,
          baselineInfraHash: null,
          summary: null,
          dataJson: [],
        })
        .run()
    }
  } catch (err) {
    progress.error = err instanceof Error ? err.message : String(err)
    console.error('[benchmark] runLoop crashed:', err)
  } finally {
    progress.running = false
    progress.phase = 'done'
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Benchmark done',
          body: `${progress.done}/${progress.total} runs · ${progress.failed} failed`,
        }).show()
      }
    } catch {
      // Notifications are best-effort; never let one break batch teardown.
    }
  }
}
