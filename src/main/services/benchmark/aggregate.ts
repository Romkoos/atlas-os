import {
  compare,
  type Delta,
  type RepMetric,
  summarize,
  type TaskInfraSummary,
} from '@main/services/benchmark/stats'
import type { InfraState } from '@main/services/productivity/infra'

// Minimal shape of a benchmark_runs row the aggregation needs. Keeping it narrow
// (not the full Drizzle row) makes the helpers pure and trivially testable.
export interface RawRun {
  taskId: string
  infraHash: string
  model: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalCostUsd: number
  success: boolean
  ts: Date
  infraSnapshot: InfraState
}

export interface SummaryRow extends TaskInfraSummary {
  model: string
  firstTs: number
  snapshot: InfraState
}

// One task's A/B step: the latest infra variant (after) vs the one before it.
export interface AbRow {
  taskId: string
  beforeInfraHash: string
  afterInfraHash: string
  tokens: Delta
  output: Delta
  cost: Delta
}

// Pure helper: project a benchmark_runs-shaped row onto the RawRun interface.
// Avoids verbatim field-mapping duplication across batch.ts and the reanalyze
// procedure. Accepts any object that structurally satisfies RawRun (e.g. a full
// Drizzle row with extra columns).
export function rowToRawRun(r: RawRun): RawRun {
  return {
    taskId: r.taskId,
    infraHash: r.infraHash,
    model: r.model,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    cacheReadTokens: r.cacheReadTokens,
    cacheCreationTokens: r.cacheCreationTokens,
    totalCostUsd: r.totalCostUsd,
    success: r.success,
    ts: r.ts,
    infraSnapshot: r.infraSnapshot,
  }
}

function toRep(r: RawRun): RepMetric {
  return {
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    cacheReadTokens: r.cacheReadTokens,
    cacheCreationTokens: r.cacheCreationTokens,
    totalCostUsd: r.totalCostUsd,
    success: r.success,
  }
}

// Group runs by (task, infra, model) and median the successful reps. Single
// source of truth for the results table and the analyzer.
export function summarizeRuns(rows: RawRun[]): SummaryRow[] {
  const groups = new Map<string, RawRun[]>()
  for (const r of rows) {
    const key = `${r.taskId}::${r.infraHash}::${r.model}`
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }
  const out: SummaryRow[] = []
  for (const g of groups.values()) {
    out.push({
      ...summarize(g[0].taskId, g[0].infraHash, g.map(toRep)),
      model: g[0].model,
      firstTs: Math.min(...g.map((r) => r.ts.getTime())),
      snapshot: g[0].infraSnapshot,
    })
  }
  return out
}

// For each task, order its infra variants by time and pair the LAST against the
// one immediately before it (the A/B step the UI shows). Tasks with <2 variants
// have no step and are skipped.
export function buildAbSlice(summaries: SummaryRow[]): AbRow[] {
  const byTask = new Map<string, SummaryRow[]>()
  for (const s of summaries) {
    const arr = byTask.get(s.taskId) ?? []
    arr.push(s)
    byTask.set(s.taskId, arr)
  }
  const out: AbRow[] = []
  for (const arr of byTask.values()) {
    if (arr.length < 2) continue
    const sorted = [...arr].sort((a, b) => a.firstTs - b.firstTs)
    const before = sorted[sorted.length - 2]
    const after = sorted[sorted.length - 1]
    out.push({
      taskId: after.taskId,
      beforeInfraHash: before.infraHash,
      afterInfraHash: after.infraHash,
      tokens: compare(after.taskId, before.medianTokens, after.medianTokens),
      output: compare(after.taskId, before.medianOutputTokens, after.medianOutputTokens),
      cost: compare(after.taskId, before.medianCostUsd, after.medianCostUsd),
    })
  }
  return out
}
