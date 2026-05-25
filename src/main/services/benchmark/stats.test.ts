// src/main/services/benchmark/stats.test.ts
import { compare, median, spread, summarize } from '@main/services/benchmark/stats'
import { describe, expect, it } from 'vitest'

describe('median', () => {
  it('odd length returns the middle', () => expect(median([3, 1, 2])).toBe(2))
  it('even length averages the middle two', () => expect(median([1, 2, 3, 4])).toBe(2.5))
})

describe('spread', () => {
  it('is the interquartile range', () => {
    expect(spread([1, 2, 3, 4, 5])).toBeCloseTo(2, 5)
  })
})

describe('summarize', () => {
  const rep = (
    tokensIn: number,
    tokensOut: number,
    cacheRead: number,
    cost: number,
    ok: boolean,
  ) => ({
    tokensIn,
    tokensOut,
    cacheReadTokens: cacheRead,
    cacheCreationTokens: 0,
    totalCostUsd: cost,
    success: ok,
  })

  it('counts cache tokens in the total and reports cached separately', () => {
    const s = summarize('t1', 'abc', [
      rep(100, 100, 1000, 0.1, true),
      rep(300, 100, 1000, 0.3, true),
      rep(0, 0, 0, 0, false),
    ])
    expect(s.n).toBe(2)
    expect(s.medianTokens).toBe(1300) // totals incl cache: 1200 and 1400 -> 1300
    expect(s.medianCacheTokens).toBe(1000) // cache 1000 and 1000 -> 1000
  })
  it('returns n=0 and NaN tokens when all reps fail', () => {
    const s = summarize('t1', 'abc', [rep(0, 0, 0, 0, false), rep(0, 0, 0, 0, false)])
    expect(s.n).toBe(0)
    expect(Number.isNaN(s.medianTokens)).toBe(true)
    expect(Number.isNaN(s.medianCacheTokens)).toBe(true)
  })
})

describe('compare', () => {
  it('computes absolute and percent delta', () => {
    const d = compare('t1', 200, 150)
    expect(d.absDelta).toBe(-50)
    expect(d.pctDelta).toBeCloseTo(-25, 5)
  })
})
