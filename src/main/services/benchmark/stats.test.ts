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
  it('excludes invalid reps and medians the token totals', () => {
    const s = summarize('t1', 'abc', [
      { tokensIn: 100, tokensOut: 100, totalCostUsd: 0.1, success: true },
      { tokensIn: 300, tokensOut: 100, totalCostUsd: 0.3, success: true },
      { tokensIn: 0, tokensOut: 0, totalCostUsd: 0, success: false },
    ])
    expect(s.n).toBe(2)
    expect(s.medianTokens).toBe(300) // totals 200 and 400 -> 300
  })
})

describe('compare', () => {
  it('computes absolute and percent delta', () => {
    const d = compare('t1', 200, 150)
    expect(d.absDelta).toBe(-50)
    expect(d.pctDelta).toBeCloseTo(-25, 5)
  })
})
