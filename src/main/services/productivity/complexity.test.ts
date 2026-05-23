import { complexityFromPercentiles, percentileRanks } from '@main/services/productivity/complexity'
import { describe, expect, it } from 'vitest'

describe('percentileRanks', () => {
  it('returns 0.5 for a single value', () => {
    expect(percentileRanks([42])).toEqual([0.5])
  })

  it('returns [] for empty input', () => {
    expect(percentileRanks([])).toEqual([])
  })

  it('uses mid-rank for ties', () => {
    // two equal values: each has countLess=0, countEqual=2 -> (0 + 0.5*2)/2 = 0.5
    expect(percentileRanks([5, 5])).toEqual([0.5, 0.5])
  })

  it('ranks distinct values by position', () => {
    // [10,20,30]: 10 -> (0+0.5)/3, 20 -> (1+0.5)/3, 30 -> (2+0.5)/3
    expect(percentileRanks([10, 20, 30])).toEqual([0.5 / 3, 1.5 / 3, 2.5 / 3])
  })
})

describe('complexityFromPercentiles', () => {
  it('maps mean percentile 0 -> 1 and 1 -> 10', () => {
    expect(complexityFromPercentiles([0, 0, 0])).toBe(1)
    expect(complexityFromPercentiles([1, 1, 1])).toBe(10)
  })

  it('maps mean percentile 0.5 -> 5.5', () => {
    expect(complexityFromPercentiles([0.5, 0.5])).toBe(5.5)
  })

  it('clamps and handles empty input as midpoint 1', () => {
    expect(complexityFromPercentiles([])).toBe(1)
  })
})
