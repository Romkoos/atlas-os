// KPI = efficiency coefficient (0–100%). Per session, raw efficiency is
// (quality × complexity) / tokens; that raw value is percentile-ranked across
// the whole session corpus (in the tRPC layer, via percentileRanks — the same
// machinery as complexity). A set's KPI is the mean of its members' percentiles
// × 100 — bounded, smooth, and independent of token volume.
// See docs/superpowers/specs/2026-05-23-kpd-efficiency-metric-design.md

/** Imputed quality for sessions the user has not rated (1–10 scale midpoint). */
export const UNRATED_SCORE = 5.5

// Raw per-session efficiency: (score ?? 5.5) × complexity / tokens.
// Null when complexity is unknown or tokens are non-positive (not rankable).
export function rawEfficiency(
  score: number | null,
  complexity: number | null,
  tokens: number,
): number | null {
  if (complexity == null || tokens <= 0) return null
  return ((score ?? UNRATED_SCORE) * complexity) / tokens
}

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

// Mean of percentile ranks (each 0..1) → coefficient 0..100. Null if empty.
export function kpiCoefficient(percentiles: number[]): number | null {
  return percentiles.length === 0 ? null : mean(percentiles) * 100
}

/** A session's percentile rank (0..1) tagged with its local calendar day. */
export interface KpiDaySession {
  day: string
  percentile: number
}

export interface KpiDay {
  date: string
  kpi: number
  sessions: number
}

// Group sessions by day, average each day's percentiles → 0..100, sort by date.
export function kpiByDay(sessions: KpiDaySession[]): KpiDay[] {
  const byDay = new Map<string, number[]>()
  for (const s of sessions) {
    const arr = byDay.get(s.day) ?? []
    arr.push(s.percentile)
    byDay.set(s.day, arr)
  }
  const out: KpiDay[] = []
  for (const [date, ps] of byDay) {
    const kpi = kpiCoefficient(ps)
    if (kpi == null) continue
    out.push({ date, kpi, sessions: ps.length })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

// ── Frozen-baseline КПД model ────────────────────────────────────────────────
// КПД = expectedTokens(difficulty) / actualTokens × 100. expectedTokens comes
// from a baseline frozen at the project's starting period. Two methods:
//   - global-median: expected = median baseline tokens (difficulty ignored).
//     Used until enough difficulty-tagged data exists. Makes КПД work day one.
//   - loglinear: expected = exp(a + b·difficulty), fit on baseline medians.
//     Used once ≥8 difficulty-tagged sessions span ≥2 difficulty levels.

export type BaselineMethod = 'loglinear' | 'global-median'
export interface BaselineParams {
  a?: number
  b?: number
  median?: number
}
export interface BaselineModel {
  method: BaselineMethod
  params: BaselineParams
}
export interface BaselineSample {
  difficulty: number | null
  tokens: number
}

const MIN_DIFFICULTY_COVERAGE = 8

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Fit a frozen baseline from starting-period samples. Null if no usable tokens.
export function fitBaseline(samples: BaselineSample[]): BaselineModel | null {
  const valid = samples.filter((s) => s.tokens > 0)
  if (valid.length === 0) return null

  const withDiff = valid.filter(
    (s): s is { difficulty: number; tokens: number } => s.difficulty != null,
  )
  if (withDiff.length >= MIN_DIFFICULTY_COVERAGE) {
    const byD = new Map<number, number[]>()
    for (const s of withDiff) {
      const arr = byD.get(s.difficulty) ?? []
      arr.push(Math.log(s.tokens))
      byD.set(s.difficulty, arr)
    }
    if (byD.size >= 2) {
      // Least squares on per-difficulty medians of log(tokens) → robust slope.
      const pts = [...byD.entries()].map(([x, logs]) => ({ x, y: medianOf(logs) }))
      const n = pts.length
      const sx = pts.reduce((a, p) => a + p.x, 0)
      const sy = pts.reduce((a, p) => a + p.y, 0)
      const sxx = pts.reduce((a, p) => a + p.x * p.x, 0)
      const sxy = pts.reduce((a, p) => a + p.x * p.y, 0)
      const denom = n * sxx - sx * sx
      if (denom !== 0) {
        const b = (n * sxy - sx * sy) / denom
        const a = (sy - b * sx) / n
        if (b > 0) return { method: 'loglinear', params: { a, b } }
      }
    }
  }
  return { method: 'global-median', params: { median: medianOf(valid.map((s) => s.tokens)) } }
}

// Expected token cost for a task of the given difficulty under the frozen model.
export function expectedTokens(model: BaselineModel, difficulty: number | null): number | null {
  if (model.method === 'global-median') return model.params.median ?? null
  if (difficulty == null) return null
  const { a, b } = model.params
  if (a == null || b == null) return null
  return Math.exp(a + b * difficulty)
}

// Per-session КПД (%). >100 = leaner than baseline. Null on unusable inputs.
export function sessionKpd(expected: number | null, actualTokens: number): number | null {
  if (expected == null || expected <= 0 || actualTokens <= 0) return null
  return (expected / actualTokens) * 100
}

/** A session's КПД (%) for a local calendar day, plus optional quality score. */
export interface KpdDaySession {
  day: string
  kpd: number
  score: number | null
}

export interface KpdDay {
  date: string
  kpi: number // mean КПД (%)
  quality: number | null // mean of rated scores that day, or null
  sessions: number
}

// Group by day; mean КПД and mean rated quality per day; sort by date.
export function kpdByDay(sessions: KpdDaySession[]): KpdDay[] {
  const byDay = new Map<string, { kpds: number[]; scores: number[] }>()
  for (const s of sessions) {
    const e = byDay.get(s.day) ?? { kpds: [], scores: [] }
    e.kpds.push(s.kpd)
    if (s.score != null) e.scores.push(s.score)
    byDay.set(s.day, e)
  }
  const out: KpdDay[] = []
  for (const [date, e] of byDay) {
    if (e.kpds.length === 0) continue
    out.push({
      date,
      kpi: e.kpds.reduce((a, x) => a + x, 0) / e.kpds.length,
      quality: e.scores.length ? e.scores.reduce((a, x) => a + x, 0) / e.scores.length : null,
      sessions: e.kpds.length,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
