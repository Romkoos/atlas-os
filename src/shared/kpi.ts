// КПД = frozen-baseline efficiency coefficient (%). Per session:
//   КПД = expectedTokens(difficulty, baseline) / actualTokens × 100.
// expectedTokens comes from a baseline frozen at the project's starting period.
// Two methods: global-median (day-one fallback) and loglinear (once ≥8
// difficulty-tagged sessions span ≥2 difficulty levels).

// ── Frozen-baseline КПД model ────────────────────────────────────────────────
// КПД = expectedTokens(difficulty) / actualTokens × 100. expectedTokens comes
// from a baseline frozen at the project's starting period. Two methods:
//   - global-median: expected = median baseline tokens (difficulty ignored).
//     Used until enough difficulty-tagged data exists. Makes КПД work day one.
//   - loglinear: expected = exp(a + b·difficulty), fit on baseline medians.
//     Used only once difficulty coverage is high (absolute ≥8 AND ≥50% of the
//     baseline); always carries a median fallback so untagged sessions still
//     get a КПД instead of being dropped from the line.

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

// loglinear needs enough difficulty-tagged samples in absolute terms AND as a
// fraction of the baseline. The fraction gate is critical: a handful of manually
// rated sessions (e.g. 9 of 400) must NOT force a noisy loglinear fit that then
// drops every untagged session from the КПД line.
const MIN_DIFFICULTY_COVERAGE = 8
const MIN_DIFFICULTY_FRACTION = 0.5

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Fit a frozen baseline from starting-period samples. Null if no usable tokens.
// `median` is always stored — even for loglinear — so untagged sessions have a
// fallback expectation instead of being excluded.
export function fitBaseline(samples: BaselineSample[]): BaselineModel | null {
  const valid = samples.filter((s) => s.tokens > 0)
  if (valid.length === 0) return null

  const median = medianOf(valid.map((s) => s.tokens))
  const withDiff = valid.filter(
    (s): s is { difficulty: number; tokens: number } => s.difficulty != null,
  )
  if (
    withDiff.length >= MIN_DIFFICULTY_COVERAGE &&
    withDiff.length >= MIN_DIFFICULTY_FRACTION * valid.length
  ) {
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
        if (b > 0) return { method: 'loglinear', params: { a, b, median } }
      }
    }
  }
  return { method: 'global-median', params: { median } }
}

// Expected token cost for a task of the given difficulty under the frozen model.
// Loglinear sessions without a difficulty fall back to the stored median so they
// still get a КПД (otherwise the line collapses to only the rated sessions).
export function expectedTokens(model: BaselineModel, difficulty: number | null): number | null {
  if (model.method === 'global-median') return model.params.median ?? null
  if (difficulty == null) return model.params.median ?? null
  const { a, b } = model.params
  if (a == null || b == null) return model.params.median ?? null
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
