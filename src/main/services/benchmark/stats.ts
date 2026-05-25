// src/main/services/benchmark/stats.ts
export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1]
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base])
}

export function spread(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const s = [...xs].sort((a, b) => a - b)
  return quantile(s, 0.75) - quantile(s, 0.25)
}

export interface RepMetric {
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalCostUsd: number
  success: boolean
}

export interface TaskInfraSummary {
  taskId: string
  infraHash: string
  n: number
  // Total tokens processed per run INCLUDING cached input. The infra under test
  // (CLAUDE.md + MCP tool schemas + skills) is the cached prefix, so cache_read
  // is the bulk of an infra's cost — counting it is what makes this measure infra.
  medianTokens: number
  spreadTokens: number
  // Just the cached portion (cache_read + cache_creation), so the infra-prefix
  // size is visible on its own — it's what shifts when infra changes.
  medianCacheTokens: number
  medianCostUsd: number
}

export function summarize(taskId: string, infraHash: string, reps: RepMetric[]): TaskInfraSummary {
  const valid = reps.filter((r) => r.success)
  const tokens = valid.map(
    (r) => r.tokensIn + r.tokensOut + r.cacheReadTokens + r.cacheCreationTokens,
  )
  const cache = valid.map((r) => r.cacheReadTokens + r.cacheCreationTokens)
  const costs = valid.map((r) => r.totalCostUsd)
  return {
    taskId,
    infraHash,
    n: valid.length,
    medianTokens: median(tokens),
    spreadTokens: spread(tokens),
    medianCacheTokens: median(cache),
    medianCostUsd: median(costs),
  }
}

export interface Delta {
  taskId: string
  before: number
  after: number
  absDelta: number
  pctDelta: number
}

export function compare(taskId: string, before: number, after: number): Delta {
  const absDelta = after - before
  return {
    taskId,
    before,
    after,
    absDelta,
    pctDelta: before === 0 ? Number.NaN : (absDelta / before) * 100,
  }
}
