import type { AbRow } from '@main/services/benchmark/aggregate'
import { buildAnalysisPrompt } from '@main/services/benchmark/analysis'
import { describe, expect, it } from 'vitest'

const delta = (before: number, after: number) => ({
  taskId: 't1',
  before,
  after,
  absDelta: after - before,
  pctDelta: before === 0 ? Number.NaN : ((after - before) / before) * 100,
})

const slice: AbRow[] = [
  {
    taskId: 't1',
    beforeInfraHash: 'A',
    afterInfraHash: 'B',
    tokens: delta(1000, 800),
    output: delta(100, 90),
    cost: delta(0.1, 0.08),
  },
]

describe('buildAnalysisPrompt', () => {
  it('includes the task, the token delta, and a 2-3 sentence instruction', () => {
    const p = buildAnalysisPrompt(slice)
    expect(p).toContain('t1')
    expect(p).toContain('-20.0%') // token pctDelta
    expect(p).toMatch(/2-3 sentence/i)
    expect(p).toMatch(/plain language/i)
  })
})
