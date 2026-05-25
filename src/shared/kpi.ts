// Eff = frozen-baseline efficiency coefficient (%). Per session:
//   Eff = expectedTokens(difficulty, baseline) / actualTokens × 100.
// expectedTokens comes from a baseline frozen at the project's starting period.
// Two methods: global-median (day-one fallback) and loglinear (once ≥8
// difficulty-tagged sessions span ≥2 difficulty levels).

// ── Frozen-baseline Eff model ────────────────────────────────────────────────
// Eff = expectedTokens(difficulty) / actualTokens × 100. expectedTokens comes
// from a baseline frozen at the project's starting period. Two methods:
//   - global-median: expected = median baseline tokens (difficulty ignored).
//     Used until enough difficulty-tagged data exists. Makes Eff work day one.
//   - loglinear: expected = exp(a + b·difficulty), fit on baseline medians.
//     Used only once difficulty coverage is high (absolute ≥8 AND ≥50% of the
//     baseline); always carries a median fallback so untagged sessions still
//     get a Eff instead of being dropped from the line.

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
// drops every untagged session from the Eff line.
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
// still get a Eff (otherwise the line collapses to only the rated sessions).
export function expectedTokens(model: BaselineModel, difficulty: number | null): number | null {
  if (model.method === 'global-median') return model.params.median ?? null
  if (difficulty == null) return model.params.median ?? null
  const { a, b } = model.params
  if (a == null || b == null) return model.params.median ?? null
  return Math.exp(a + b * difficulty)
}

// A session must have spent at least this fraction of its expected tokens to
// earn an Eff. Below it the ratio is dominated by a near-empty session and
// explodes: a 17k-token session against a ~210k baseline reads as 1200%
// "efficiency", which is noise, not productivity — and on a low-session day or a
// single-project scope token-weighting can't damp it (n=1 collapses to that one
// ratio). The floor is fractional, not absolute, so it adapts to scope and
// difficulty via `expected`; it also bounds Eff at 1/MIN_WORK_FRACTION × 100%.
export const MIN_WORK_FRACTION = 1 / 3

// Per-session Eff (%). >100 = leaner than baseline. Null on unusable inputs or
// when the session did too little work to compare (see MIN_WORK_FRACTION).
export function sessionKpd(expected: number | null, actualTokens: number): number | null {
  if (expected == null || expected <= 0 || actualTokens <= 0) return null
  if (actualTokens < expected * MIN_WORK_FRACTION) return null
  return (expected / actualTokens) * 100
}

/** A session's token counts for a local calendar day, plus optional quality. */
export interface KpdDaySession {
  day: string
  expected: number // expected tokens under the frozen baseline
  actual: number // actual tokens the session consumed
  score: number | null
}

export interface KpdDay {
  date: string
  kpi: number // token-weighted Eff (%) = Σexpected / Σactual × 100
  quality: number | null // mean of rated scores that day, or null
  sessions: number
}

// Group by day; token-weighted Eff and mean rated quality per day; sort by date.
// Token-weighting (Σexpected/Σactual) instead of mean-of-ratios stops a single
// tiny-token session from blowing the daily Eff up to 800–1000%: a near-empty
// session contributes almost nothing to the denominator instead of dominating
// an unweighted average. Sessions with non-positive expected/actual are dropped.
export function kpdByDay(sessions: KpdDaySession[]): KpdDay[] {
  const byDay = new Map<string, { exp: number; act: number; n: number; scores: number[] }>()
  for (const s of sessions) {
    if (!(s.expected > 0) || !(s.actual > 0)) continue
    const e = byDay.get(s.day) ?? { exp: 0, act: 0, n: 0, scores: [] }
    e.exp += s.expected
    e.act += s.actual
    e.n += 1
    if (s.score != null) e.scores.push(s.score)
    byDay.set(s.day, e)
  }
  const out: KpdDay[] = []
  for (const [date, e] of byDay) {
    if (e.n === 0 || e.act <= 0) continue
    out.push({
      date,
      kpi: (e.exp / e.act) * 100,
      quality: e.scores.length ? e.scores.reduce((a, x) => a + x, 0) / e.scores.length : null,
      sessions: e.n,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
