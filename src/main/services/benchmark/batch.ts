// src/main/services/benchmark/batch.ts
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { db } from '@main/db/client'
import { benchmarkRuns } from '@main/db/schema'
import { appPaths } from '@main/paths'
import { infraFingerprint } from '@main/services/benchmark/fingerprint'
import { repoCommit, runBenchmarkTask } from '@main/services/benchmark/runner'
import { TASKS } from '@main/services/benchmark/tasks'
import type { BenchmarkTask } from '@main/services/benchmark/types'
import { readInfraState } from '@main/services/productivity/infra'
import { app } from 'electron'

const DEFAULT_K = 5
const DEFAULT_MODEL = 'claude-sonnet-4-6'

export interface Progress {
  batchId: string
  total: number
  done: number
  failed: number
  running: boolean
}

const batches = new Map<string, Progress>()

export function getProgress(batchId: string): Progress | null {
  return batches.get(batchId) ?? null
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
  const progress: Progress = { batchId, total, done: 0, failed: 0, running: true }
  batches.set(batchId, progress)
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
      const result = await runBenchmarkTask(task, { model, repoRoot })
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
  progress.running = false
}
