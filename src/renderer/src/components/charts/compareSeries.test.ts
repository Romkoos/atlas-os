import { describe, expect, it } from 'vitest'
import { dailyDateAxis, overlayPrevious } from './compareSeries'

describe('dailyDateAxis', () => {
  it('unions dates across sources, ascending, deduped', () => {
    const a = [{ date: '2026-05-03' }, { date: '2026-05-01' }]
    const b = [{ date: '2026-05-02' }, { date: '2026-05-01' }]
    expect(dailyDateAxis(a, b)).toEqual(['2026-05-01', '2026-05-02', '2026-05-03'])
  })

  it('returns empty for no sources', () => {
    expect(dailyDateAxis()).toEqual([])
  })
})

describe('overlayPrevious', () => {
  it('writes prev values onto rows by index', () => {
    const rows = [{ date: 'a' }, { date: 'b' }]
    expect(overlayPrevious(rows, 'prev', [10, 20])).toEqual([
      { date: 'a', prev: 10 },
      { date: 'b', prev: 20 },
    ])
  })

  it('fills missing prev entries with null', () => {
    const rows = [{ date: 'a' }, { date: 'b' }]
    expect(overlayPrevious(rows, 'prev', [10])).toEqual([
      { date: 'a', prev: 10 },
      { date: 'b', prev: null },
    ])
  })

  it('keeps a prev value of 0 (does not treat it as missing)', () => {
    const rows = [{ date: 'a' }]
    expect(overlayPrevious(rows, 'prev', [0])).toEqual([{ date: 'a', prev: 0 }])
  })

  it('drops extra prev entries beyond rows', () => {
    const rows = [{ date: 'a' }]
    expect(overlayPrevious(rows, 'prev', [1, 2, 3])).toEqual([{ date: 'a', prev: 1 }])
  })
})
