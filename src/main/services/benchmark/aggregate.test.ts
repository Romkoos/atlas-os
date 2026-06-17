import {
  buildAbSlice,
  type RawRun,
  rowToRawRun,
  summarizeRuns,
} from '@main/services/benchmark/aggregate'
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

describe('rowToRawRun', () => {
  it('copies all 11 fields through unchanged', () => {
    const input: RawRun = {
      taskId: 'task-1',
      infraHash: 'abc123',
      model: 'claude-sonnet-4-6',
      tokensIn: 1000,
      tokensOut: 250,
      cacheReadTokens: 50,
      cacheCreationTokens: 10,
      totalCostUsd: 0.0042,
      success: true,
      ts: new Date(1700000000000),
      infraSnapshot: snap,
    }
    const out = rowToRawRun(input)
    expect(out.taskId).toBe(input.taskId)
    expect(out.infraHash).toBe(input.infraHash)
    expect(out.model).toBe(input.model)
    expect(out.tokensIn).toBe(input.tokensIn)
    expect(out.tokensOut).toBe(input.tokensOut)
    expect(out.cacheReadTokens).toBe(input.cacheReadTokens)
    expect(out.cacheCreationTokens).toBe(input.cacheCreationTokens)
    expect(out.totalCostUsd).toBe(input.totalCostUsd)
    expect(out.success).toBe(input.success)
    expect(out.ts).toBe(input.ts)
    expect(out.infraSnapshot).toBe(input.infraSnapshot)
  })
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
