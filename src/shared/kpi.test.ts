import { kpiByDay, kpiCoefficient, rawEfficiency, UNRATED_SCORE } from '@shared/kpi'
import { describe, expect, it } from 'vitest'

describe('UNRATED_SCORE', () => {
  it('is the 1–10 scale midpoint', () => {
    expect(UNRATED_SCORE).toBe(5.5)
  })
})

describe('rawEfficiency', () => {
  it('computes (score × complexity) / tokens', () => {
    expect(rawEfficiency(9, 7, 1_000_000)).toBeCloseTo((9 * 7) / 1_000_000, 12)
  })
  it('imputes 5.5 when unrated', () => {
    expect(rawEfficiency(null, 4, 2_000_000)).toBeCloseTo((5.5 * 4) / 2_000_000, 12)
  })
  it('returns null when complexity is null', () => {
    expect(rawEfficiency(8, null, 1_000_000)).toBeNull()
  })
  it('returns null when tokens are zero or negative', () => {
    expect(rawEfficiency(8, 5, 0)).toBeNull()
    expect(rawEfficiency(8, 5, -5)).toBeNull()
  })
})

describe('kpiCoefficient', () => {
  it('is the mean of percentiles × 100', () => {
    expect(kpiCoefficient([0.2, 0.8])).toBe(50)
    expect(kpiCoefficient([1])).toBe(100)
    expect(kpiCoefficient([0])).toBe(0)
  })
  it('returns null for empty input', () => {
    expect(kpiCoefficient([])).toBeNull()
  })
})

describe('kpiByDay', () => {
  it('groups by day, averages percentiles ×100, sorts by date', () => {
    const out = kpiByDay([
      { day: '2026-05-02', percentile: 0.5 },
      { day: '2026-05-01', percentile: 0.2 },
      { day: '2026-05-01', percentile: 0.8 },
    ])
    expect(out).toEqual([
      { date: '2026-05-01', kpi: 50, sessions: 2 },
      { date: '2026-05-02', kpi: 50, sessions: 1 },
    ])
  })
  it('returns [] for empty input', () => {
    expect(kpiByDay([])).toEqual([])
  })
})
