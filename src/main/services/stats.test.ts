import { buildDateRange, fillDailySeries, toLocalDateString } from '@main/services/stats'
import { describe, expect, it } from 'vitest'

describe('toLocalDateString', () => {
  it('formats with zero-padding', () => {
    expect(toLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(toLocalDateString(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('buildDateRange', () => {
  it('returns `days` ascending dates ending on today', () => {
    const range = buildDateRange(30, new Date(2026, 4, 22))
    expect(range).toHaveLength(30)
    expect(range[29]).toBe('2026-05-22')
    expect(range[28]).toBe('2026-05-21')
    expect(range[0]).toBe('2026-04-23')
  })

  it('handles a single day', () => {
    expect(buildDateRange(1, new Date(2026, 4, 22))).toEqual(['2026-05-22'])
  })
})

describe('fillDailySeries', () => {
  it('zero-fills missing days and keeps known counts', () => {
    const today = new Date(2026, 4, 22)
    const series = fillDailySeries([{ day: '2026-05-22', count: 3 }], 3, today)
    expect(series).toEqual([
      { date: '2026-05-20', count: 0 },
      { date: '2026-05-21', count: 0 },
      { date: '2026-05-22', count: 3 },
    ])
  })

  it('ignores counts outside the range', () => {
    const today = new Date(2026, 4, 22)
    const series = fillDailySeries(
      [
        { day: '2026-05-22', count: 5 },
        { day: '2026-01-01', count: 99 },
      ],
      2,
      today,
    )
    expect(series).toEqual([
      { date: '2026-05-21', count: 0 },
      { date: '2026-05-22', count: 5 },
    ])
  })
})
