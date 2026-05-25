import { describe, expect, it } from 'vitest'
import { inDayRange, summarizeDay } from './daySessions'

describe('inDayRange', () => {
  it('includes a day inside [start, end]', () => {
    expect(inDayRange('2026-05-10', '2026-05-09', '2026-05-11')).toBe(true)
  })
  it('includes the boundary days', () => {
    expect(inDayRange('2026-05-09', '2026-05-09', '2026-05-11')).toBe(true)
    expect(inDayRange('2026-05-11', '2026-05-09', '2026-05-11')).toBe(true)
  })
  it('excludes days before start or after end', () => {
    expect(inDayRange('2026-05-08', '2026-05-09', '2026-05-11')).toBe(false)
    expect(inDayRange('2026-05-12', '2026-05-09', '2026-05-11')).toBe(false)
  })
  it('tolerates a null bound as open-ended', () => {
    expect(inDayRange('2026-05-10', null, '2026-05-11')).toBe(true)
    expect(inDayRange('2026-05-10', '2026-05-09', null)).toBe(true)
  })
  it('returns false when both bounds are null (cannot place the session)', () => {
    expect(inDayRange('2026-05-10', null, null)).toBe(false)
  })
})

describe('summarizeDay', () => {
  it('returns zeros for an empty day', () => {
    expect(summarizeDay([])).toEqual({ count: 0, totalTokens: 0, avgKpi: null, byProject: [] })
  })
  it('sums tokens, averages non-null Eff, groups projects desc by tokens', () => {
    const out = summarizeDay([
      { totalTokens: 100, kpi: 80, project: 'atlas' },
      { totalTokens: 300, kpi: null, project: 'mako' },
      { totalTokens: 50, kpi: 120, project: 'atlas' },
    ])
    expect(out.count).toBe(3)
    expect(out.totalTokens).toBe(450)
    expect(out.avgKpi).toBe(100) // (80 + 120) / 2; null skipped
    expect(out.byProject).toEqual([
      { project: 'mako', tokens: 300, sessions: 1 },
      { project: 'atlas', tokens: 150, sessions: 2 },
    ])
  })
})
