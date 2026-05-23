import { kpiByDay, kpiSession, kpiWindow, UNRATED_SCORE } from '@shared/kpi'
import { describe, expect, it } from 'vitest'

describe('UNRATED_SCORE', () => {
  it('is the 1–10 scale midpoint', () => {
    expect(UNRATED_SCORE).toBe(5.5)
  })
})

describe('kpiSession', () => {
  it('computes (score × complexity) per 1M tokens', () => {
    // 9 × 7 / (1_000_000 / 1e6) = 63
    expect(kpiSession(9, 7, 1_000_000)).toBe(63)
  })

  it('imputes 5.5 for an unrated session', () => {
    // 5.5 × 4 / (2_000_000 / 1e6) = 22 / 2 = 11
    expect(kpiSession(null, 4, 2_000_000)).toBe(11)
  })

  it('returns null when complexity is null', () => {
    expect(kpiSession(8, null, 1_000_000)).toBeNull()
  })

  it('returns null when tokens are zero or negative', () => {
    expect(kpiSession(8, 5, 0)).toBeNull()
    expect(kpiSession(8, 5, -10)).toBeNull()
  })
})

describe('kpiWindow', () => {
  it('is token-weighted: a heavy session drags the window down', () => {
    // light: q5.5×comp8 on 0.1M ; heavy: q5.5×comp2 on 10M
    // Σqc = 44 + 11 = 55 ; Σtok = 10_100_000 ; kpi = 55 / 10.1 ≈ 5.4455
    const v = kpiWindow([
      { score: null, complexity: 8, tokens: 100_000 },
      { score: null, complexity: 2, tokens: 10_000_000 },
    ])
    expect(v).toBeCloseTo(55 / 10.1, 4)
  })

  it('skips unusable sessions (null complexity / zero tokens)', () => {
    // only the valid 5.5×6 on 1M counts -> 33
    const v = kpiWindow([
      { score: null, complexity: 6, tokens: 1_000_000 },
      { score: 9, complexity: null, tokens: 5_000_000 },
      { score: 9, complexity: 9, tokens: 0 },
    ])
    expect(v).toBe(33)
  })

  it('returns null for an empty / fully-unusable window', () => {
    expect(kpiWindow([])).toBeNull()
    expect(kpiWindow([{ score: 9, complexity: null, tokens: 0 }])).toBeNull()
  })
})

describe('kpiByDay', () => {
  it('groups by day, token-weights within a day, sorts by date', () => {
    const out = kpiByDay([
      { day: '2026-05-02', score: null, complexity: 6, tokens: 1_000_000 },
      { day: '2026-05-01', score: 10, complexity: 5, tokens: 1_000_000 },
      { day: '2026-05-01', score: null, complexity: 5, tokens: 1_000_000 },
    ])
    expect(out.map((d) => d.date)).toEqual(['2026-05-01', '2026-05-02'])
    // 2026-05-01: (10×5 + 5.5×5) / 2 = 77.5 / 2 = 38.75 ; sessions 2 ; tokens 2_000_000
    expect(out[0]).toEqual({ date: '2026-05-01', kpi: 38.75, sessions: 2, tokens: 2_000_000 })
    // 2026-05-02: 5.5×6 / 1 = 33
    expect(out[1]).toEqual({ date: '2026-05-02', kpi: 33, sessions: 1, tokens: 1_000_000 })
  })

  it('drops days whose sessions are all unusable', () => {
    const out = kpiByDay([{ day: '2026-05-01', score: 9, complexity: null, tokens: 0 }])
    expect(out).toEqual([])
  })
})
