import {
  type BaselineModel,
  type BaselineSample,
  expectedTokens,
  fitBaseline,
  kpdByDay,
  r2LogScale,
  rollingMedian,
  sessionKpd,
} from '@shared/kpi'
import { describe, expect, it } from 'vitest'

// Build a baseline sample where tokens scale with task scope (files/dirs), the
// signal the scope model is meant to capture.
const sample = (files: number, dirs: number, tokens: number): BaselineSample => ({
  files,
  dirs,
  tokens,
})

describe('fitBaseline', () => {
  it('returns null when no valid samples', () => {
    expect(fitBaseline([])).toBeNull()
    expect(fitBaseline([sample(3, 1, 0)])).toBeNull()
  })

  it('falls back to global-median when scope has no variation', () => {
    // every session touched the same scope → nothing to regress on
    const samples = Array.from({ length: 10 }, () => sample(2, 1, 0)).map((s, i) => ({
      ...s,
      tokens: [100, 300, 200, 250, 150, 400, 220, 180, 260, 240][i],
    }))
    const m = fitBaseline(samples)
    expect(m?.method).toBe('global-median')
    expect(m?.params.median).toBeGreaterThan(0)
  })

  it('fits a scope model when tokens scale with files/dirs', () => {
    // tokens grow with scope; ≥8 samples spanning several scope sizes
    const samples = Array.from({ length: 12 }, (_, i) => {
      const files = i + 1
      const dirs = 1 + Math.floor(i / 2)
      return sample(files, dirs, 5000 * files + 200 * dirs)
    })
    const m = fitBaseline(samples)
    expect(m?.method).toBe('scope')
    // expected must rise with a larger task scope
    const small = expectedTokens(m as BaselineModel, { files: 1, dirs: 1 }) as number
    const big = expectedTokens(m as BaselineModel, { files: 12, dirs: 6 }) as number
    expect(big).toBeGreaterThan(small)
  })

  it('always stores a median fallback even in scope mode', () => {
    const samples = Array.from({ length: 12 }, (_, i) => sample(i + 1, 1 + (i % 3), 1000 * (i + 1)))
    const m = fitBaseline(samples)
    expect(m?.method).toBe('scope')
    expect(m?.params.median).toBeGreaterThan(0)
  })
})

describe('expectedTokens', () => {
  it('global-median ignores scope', () => {
    const m: BaselineModel = { method: 'global-median', params: { median: 500 } }
    expect(expectedTokens(m, null)).toBe(500)
    expect(expectedTokens(m, { files: 9, dirs: 4 })).toBe(500)
  })

  it('scope returns exp(a + bFiles·log1p(files) + bDirs·log1p(dirs))', () => {
    const m: BaselineModel = { method: 'scope', params: { a: 0, bFiles: 1, bDirs: 0, median: 1 } }
    expect(expectedTokens(m, { files: 0, dirs: 0 })).toBeCloseTo(Math.exp(0), 6) // log1p(0)=0
    expect(expectedTokens(m, { files: Math.E - 1, dirs: 0 })).toBeCloseTo(Math.exp(1), 6)
  })

  it('scope falls back to the median when scope is missing', () => {
    const m: BaselineModel = { method: 'scope', params: { a: 0, bFiles: 1, bDirs: 1, median: 777 } }
    expect(expectedTokens(m, null)).toBe(777)
  })
})

describe('sessionKpd', () => {
  it('is expected/actual × 100', () => {
    expect(sessionKpd(600, 600)).toBe(100)
    expect(sessionKpd(600, 300)).toBe(200)
  })
  it('returns null on bad inputs', () => {
    expect(sessionKpd(null, 100)).toBeNull()
    expect(sessionKpd(0, 100)).toBeNull()
    expect(sessionKpd(500, 0)).toBeNull()
  })
  it('floors out near-empty sessions (actual < expected/3)', () => {
    expect(sessionKpd(210000, 17000)).toBeNull()
    expect(sessionKpd(300, 100)).toBe(300)
    expect(sessionKpd(300, 99)).toBeNull()
  })
})

describe('rollingMedian', () => {
  it('returns the trailing-window median at each position', () => {
    expect(rollingMedian([10, 20, 30], 7)).toEqual([10, 15, 20])
  })
  it('caps the window to its size', () => {
    // window 2: [a], median(a,b), median(b,c)
    expect(rollingMedian([4, 8, 100], 2)).toEqual([4, 6, 54])
  })
  it('handles empty input', () => {
    expect(rollingMedian([], 7)).toEqual([])
  })
})

describe('kpdByDay', () => {
  it('token-weights Eff, averages quality, sorts, and adds a 7-day smoothed line', () => {
    const out = kpdByDay([
      { day: '2026-05-02', expected: 300, actual: 250, score: 8 },
      { day: '2026-05-01', expected: 300, actual: 300, score: null },
      { day: '2026-05-01', expected: 300, actual: 100, score: 6 },
    ])
    expect(out).toEqual([
      { date: '2026-05-01', kpi: 150, kpiSmooth: 150, quality: 6, sessions: 2 },
      { date: '2026-05-02', kpi: 120, kpiSmooth: 135, quality: 8, sessions: 1 },
    ])
  })
  it('a single tiny-token session cannot blow up a busy day', () => {
    const out = kpdByDay([
      { day: '2026-05-01', expected: 200000, actual: 200000, score: null },
      { day: '2026-05-01', expected: 200000, actual: 17, score: null },
    ])
    expect(out[0].kpi).toBeCloseTo((400000 / 200017) * 100, 5)
    expect(out[0].kpi).toBeLessThan(200)
  })
  it('skips sessions with non-positive expected or actual tokens', () => {
    const out = kpdByDay([
      { day: '2026-05-01', expected: 0, actual: 100, score: null },
      { day: '2026-05-01', expected: 100, actual: 0, score: null },
    ])
    expect(out).toEqual([])
  })
  it('returns [] for empty input', () => {
    expect(kpdByDay([])).toEqual([])
  })
})

describe('r2LogScale', () => {
  it('returns null when fewer than 3 samples', () => {
    const m = fitBaseline(
      Array.from({ length: 10 }, (_, i) => sample(i + 1, 1, 5000 * (i + 1))),
    ) as BaselineModel
    expect(r2LogScale([], m)).toBeNull()
    expect(r2LogScale([sample(1, 1, 100), sample(2, 1, 200)], m)).toBeNull()
  })

  it('returns null for global-median method (no log-scale predictor)', () => {
    const m: BaselineModel = { method: 'global-median', params: { median: 1000 } }
    const samples = Array.from({ length: 10 }, () => sample(2, 1, 1000))
    expect(r2LogScale(samples, m)).toBeNull()
  })

  it('approaches 1 for tokens generated from the same scope model', () => {
    // Generate samples that perfectly fit a chosen (a, bFiles, bDirs).
    const a = 5
    const bF = 1.2
    const bD = 0.4
    const samples: BaselineSample[] = []
    for (let i = 1; i <= 12; i++) {
      const files = i
      const dirs = 1 + (i % 4)
      const tokens = Math.exp(a + bF * Math.log1p(files) + bD * Math.log1p(dirs))
      samples.push({ files, dirs, tokens })
    }
    const m = fitBaseline(samples) as BaselineModel
    expect(m.method).toBe('scope')
    const r2 = r2LogScale(samples, m) as number
    expect(r2).toBeGreaterThan(0.999)
  })

  it('reports null R² when the model falls back to global-median (no scope predictor)', () => {
    // Same scope for every sample → fitBaseline produces global-median; r2LogScale must return null.
    const tokens = [100, 5000, 200, 800, 3000, 50, 7000, 120, 4500, 230]
    const samples = tokens.map((t) => sample(2, 1, t))
    const m = fitBaseline(samples)
    expect(m?.method).toBe('global-median')
    expect(r2LogScale(samples, m as BaselineModel)).toBeNull()
  })
})
