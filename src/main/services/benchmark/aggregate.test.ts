import { buildAbSlice, type RawRun, summarizeRuns } from '@main/services/benchmark/aggregate'
import type { InfraState } from '@main/services/productivity/infra'
import { describe, expect, it } from 'vitest'

const snap: InfraState = { plugins: {}, mcpActive: [], mcpDisabled: [], skills: {} }

const run = (
  taskId: string,
  infraHash: string,
  tokensIn: number,
  tokensOut: number,
  tsMs: number,
  success = true,
): RawRun => ({
  taskId,
  infraHash,
  model: 'm',
  tokensIn,
  tokensOut,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalCostUsd: 0,
  success,
  ts: new Date(tsMs),
  infraSnapshot: snap,
})

describe('summarizeRuns', () => {
  it('groups by task+infra+model and medians the successful reps', () => {
    const rows = [
      run('t1', 'A', 100, 10, 1000),
      run('t1', 'A', 300, 10, 2000),
      run('t1', 'A', 0, 0, 1500, false), // failed rep excluded
    ]
    const out = summarizeRuns(rows)
    expect(out).toHaveLength(1)
    expect(out[0].taskId).toBe('t1')
    expect(out[0].infraHash).toBe('A')
    expect(out[0].n).toBe(2)
    expect(out[0].medianTokens).toBe(210) // (110 + 310) / 2
    expect(out[0].firstTs).toBe(1000)
  })
})

describe('buildAbSlice', () => {
  it('pairs each task latest infra variant against the previous one', () => {
    const summaries = summarizeRuns([run('t1', 'A', 100, 10, 1000), run('t1', 'B', 200, 20, 2000)])
    const slice = buildAbSlice(summaries)
    expect(slice).toHaveLength(1)
    expect(slice[0]).toMatchObject({ taskId: 't1', beforeInfraHash: 'A', afterInfraHash: 'B' })
    expect(slice[0].tokens.before).toBe(110)
    expect(slice[0].tokens.after).toBe(220)
    expect(slice[0].tokens.pctDelta).toBeCloseTo(100, 5)
  })

  it('skips tasks with only one infra variant', () => {
    const slice = buildAbSlice(summarizeRuns([run('t1', 'A', 100, 10, 1000)]))
    expect(slice).toEqual([])
  })
})
