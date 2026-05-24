import { type BaselineModel, expectedTokens, fitBaseline, kpdByDay, sessionKpd } from '@shared/kpi'
import { describe, expect, it } from 'vitest'

describe('fitBaseline', () => {
  it('returns null when no valid samples', () => {
    expect(fitBaseline([])).toBeNull()
    expect(fitBaseline([{ difficulty: 5, tokens: 0 }])).toBeNull()
  })
  it('falls back to global-median when difficulty coverage is thin', () => {
    const samples = [
      { difficulty: null, tokens: 100 },
      { difficulty: null, tokens: 300 },
      { difficulty: null, tokens: 200 },
    ]
    const m = fitBaseline(samples)
    expect(m?.method).toBe('global-median')
    expect(m?.params.median).toBe(200)
  })
  it('fits loglinear when enough difficulty-tagged samples across ≥2 levels', () => {
    const samples = [
      { difficulty: 2, tokens: 1000 },
      { difficulty: 2, tokens: 1100 },
      { difficulty: 2, tokens: 900 },
      { difficulty: 2, tokens: 1000 },
      { difficulty: 8, tokens: 8000 },
      { difficulty: 8, tokens: 8200 },
      { difficulty: 8, tokens: 7800 },
      { difficulty: 8, tokens: 8000 },
    ]
    const m = fitBaseline(samples)
    expect(m?.method).toBe('loglinear')
    expect(m?.params.b).toBeGreaterThan(0)
  })
})

describe('expectedTokens', () => {
  it('global-median ignores difficulty', () => {
    const m: BaselineModel = { method: 'global-median', params: { median: 500 } }
    expect(expectedTokens(m, null)).toBe(500)
    expect(expectedTokens(m, 7)).toBe(500)
  })
  it('loglinear returns exp(a + b*d), null when difficulty missing', () => {
    const m: BaselineModel = { method: 'loglinear', params: { a: 0, b: 1 } }
    expect(expectedTokens(m, 2)).toBeCloseTo(Math.exp(2), 6)
    expect(expectedTokens(m, null)).toBeNull()
  })
})

describe('fitBaseline coverage gate', () => {
  it('stays global-median when difficulty coverage is sparse (even with ≥8 tagged)', () => {
    // 9 tagged across 2 levels but only 9/100 → too thin to trust loglinear.
    const tagged = [
      ...Array.from({ length: 5 }, () => ({ difficulty: 2, tokens: 1000 })),
      ...Array.from({ length: 4 }, () => ({ difficulty: 8, tokens: 8000 })),
    ]
    const untagged = Array.from({ length: 91 }, () => ({ difficulty: null, tokens: 5000 }))
    const m = fitBaseline([...tagged, ...untagged])
    expect(m?.method).toBe('global-median')
  })
  it('uses loglinear with high coverage and stores a median fallback', () => {
    const tagged = [
      ...Array.from({ length: 6 }, () => ({ difficulty: 2, tokens: 1000 })),
      ...Array.from({ length: 6 }, () => ({ difficulty: 8, tokens: 8000 })),
    ]
    const m = fitBaseline([...tagged, { difficulty: null, tokens: 3000 }])
    expect(m?.method).toBe('loglinear')
    expect(m?.params.median).toBeGreaterThan(0)
  })
})

describe('expectedTokens loglinear null-difficulty fallback', () => {
  it('uses the median fallback when difficulty is null', () => {
    const m: BaselineModel = { method: 'loglinear', params: { a: 0, b: 1, median: 500 } }
    expect(expectedTokens(m, null)).toBe(500)
    expect(expectedTokens(m, 2)).toBeCloseTo(Math.exp(2), 6)
  })
})

describe('sessionKpd', () => {
  it('is expected/actual × 100', () => {
    expect(sessionKpd(500, 250)).toBe(200)
    expect(sessionKpd(500, 500)).toBe(100)
  })
  it('returns null on bad inputs', () => {
    expect(sessionKpd(null, 100)).toBeNull()
    expect(sessionKpd(0, 100)).toBeNull()
    expect(sessionKpd(500, 0)).toBeNull()
  })
})

describe('kpdByDay', () => {
  it('averages КПД per day, averages rated quality, sorts by date', () => {
    const out = kpdByDay([
      { day: '2026-05-02', kpd: 120, score: 8 },
      { day: '2026-05-01', kpd: 100, score: null },
      { day: '2026-05-01', kpd: 140, score: 6 },
    ])
    expect(out).toEqual([
      { date: '2026-05-01', kpi: 120, quality: 6, sessions: 2 },
      { date: '2026-05-02', kpi: 120, quality: 8, sessions: 1 },
    ])
  })
  it('quality is null when no rated sessions that day', () => {
    const out = kpdByDay([{ day: '2026-05-01', kpd: 100, score: null }])
    expect(out[0].quality).toBeNull()
  })
  it('returns [] for empty input', () => {
    expect(kpdByDay([])).toEqual([])
  })
})
