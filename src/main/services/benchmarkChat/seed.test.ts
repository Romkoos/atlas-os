import type { AbRow } from '@main/services/benchmark/aggregate'
import { buildChatSeed } from '@main/services/benchmarkChat/seed'
import { describe, expect, it } from 'vitest'

const slice: AbRow[] = [
  {
    taskId: 't1',
    beforeInfraHash: 'A',
    afterInfraHash: 'B',
    tokens: { taskId: 't1', before: 1000, after: 800, absDelta: -200, pctDelta: -20 },
    output: { taskId: 't1', before: 100, after: 90, absDelta: -10, pctDelta: -10 },
    cost: { taskId: 't1', before: 0.1, after: 0.08, absDelta: -0.02, pctDelta: -20 },
  },
]

describe('buildChatSeed', () => {
  it('embeds the summary and the per-task data and invites discussion', () => {
    const seed = buildChatSeed('It got cheaper.', slice)
    expect(seed).toContain('It got cheaper.')
    expect(seed).toContain('t1')
    expect(seed).toContain('-20.0%')
    expect(seed).toMatch(/read-only/i)
  })

  it('handles a null summary', () => {
    const seed = buildChatSeed(null, slice)
    expect(seed).toMatch(/no automated summary/i)
  })
})
