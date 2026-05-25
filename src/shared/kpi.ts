// Eff = frozen-baseline efficiency coefficient (%). Per session:
//   Eff = expectedTokens(scope, baseline) / actualTokens × 100.
// expectedTokens comes from a baseline frozen at the project's starting period.
//
// The baseline normalises out TASK WORKLOAD so what's left is efficiency. A task's
// token cost is driven mostly by how much work it touches; on real data, file +
// directory scope explains ~73% of the variance in log(tokens). So expected is a
// frozen log-linear regression on task scope:
//   log(expected) = a + bFiles·log1p(files) + bDirs·log1p(dirs)
// Two methods:
//   - scope: the regression above. Used once the baseline period has enough
//     sessions with scope variation to fit it.
//   - global-median: expected = median baseline tokens (scope ignored). Day-one
//     fallback, and the fallback whenever scope can't be fit. Always stored as a
//     `median` param so sessions with no recorded scope still get an Eff.
//
// Why scope and not turns/tokens/tools: those are agent BEHAVIOUR (endogenous) —
// normalising by them would erase the very efficiency gain we want to measure.
// files/dirs are closer to task DEMAND. Adding behaviour predictors lifts R² by
// only ~0.07, not worth the bias.

export type BaselineMethod = 'scope' | 'global-median'
export interface BaselineParams {
  a?: number
  bFiles?: number
  bDirs?: number
  median?: number
}
export interface BaselineModel {
  method: BaselineMethod
  params: BaselineParams
}
export interface BaselineSample {
  files: number
  dirs: number
  tokens: number
}
export interface TaskScope {
  files: number
  dirs: number
}

// A scope fit needs enough sessions AND real variation in the predictors,
// otherwise the regression is noise. Below this we fall back to the median.
const MIN_SCOPE_SAMPLES = 8

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const log1p = (x: number): number => Math.log1p(Math.max(0, x))

// Ordinary least squares for y = c0 + c1·x1 + c2·x2 via Gauss-Jordan on the 3×3
// normal equations. Returns null if the system is singular (no predictor
// variation / collinear), which is the signal to fall back to the median.
function ols2(x1: number[], x2: number[], y: number[]): [number, number, number] | null {
  const n = y.length
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  const b = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    const row = [1, x1[i], x2[i]]
    for (let a = 0; a < 3; a++) {
      b[a] += row[a] * y[i]
      for (let c = 0; c < 3; c++) A[a][c] += row[a] * row[c]
    }
  }
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-9) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    const piv = M[c][c]
    for (let cc = c; cc < 4; cc++) M[c][cc] /= piv
    for (let r = 0; r < 3; r++)
      if (r !== c) {
        const f = M[r][c]
        for (let cc = c; cc < 4; cc++) M[r][cc] -= f * M[c][cc]
      }
  }
  const coef: [number, number, number] = [M[0][3], M[1][3], M[2][3]]
  return coef.every(Number.isFinite) ? coef : null
}

// Fit a frozen baseline from starting-period samples. Null if no usable tokens.
// `median` is always stored — even for scope — so sessions with no recorded scope
// have a fallback expectation instead of being excluded.
export function fitBaseline(samples: BaselineSample[]): BaselineModel | null {
  const valid = samples.filter((s) => s.tokens > 0)
  if (valid.length === 0) return null

  const median = medianOf(valid.map((s) => s.tokens))
  if (valid.length >= MIN_SCOPE_SAMPLES) {
    const xf = valid.map((s) => log1p(s.files))
    const xd = valid.map((s) => log1p(s.dirs))
    const y = valid.map((s) => Math.log(s.tokens))
    const coef = ols2(xf, xd, y)
    if (coef) {
      const [a, bFiles, bDirs] = coef
      return { method: 'scope', params: { a, bFiles, bDirs, median } }
    }
  }
  return { method: 'global-median', params: { median } }
}

// Expected token cost for a task of the given scope under the frozen model.
// Sessions with no recorded scope fall back to the stored median so they still
// get an Eff (otherwise the line collapses to only scope-tagged sessions).
export function expectedTokens(model: BaselineModel, scope: TaskScope | null): number | null {
  if (model.method === 'scope') {
    const { a, bFiles, bDirs, median } = model.params
    if (scope == null || a == null || bFiles == null || bDirs == null) return median ?? null
    const v = Math.exp(a + bFiles * log1p(scope.files) + bDirs * log1p(scope.dirs))
    return Number.isFinite(v) && v > 0 ? v : (median ?? null)
  }
  // global-median (and any legacy/unknown method): scope ignored.
  return model.params.median ?? null
}

// A session must have spent at least this fraction of its expected tokens to
// earn an Eff. Below it the ratio is dominated by a near-empty session and
// explodes; the floor also bounds Eff at 1/MIN_WORK_FRACTION × 100%.
export const MIN_WORK_FRACTION = 1 / 3

// Per-session Eff (%). >100 = leaner than baseline. Null on unusable inputs or
// when the session did too little work to compare (see MIN_WORK_FRACTION).
export function sessionKpd(expected: number | null, actualTokens: number): number | null {
  if (expected == null || expected <= 0 || actualTokens <= 0) return null
  if (actualTokens < expected * MIN_WORK_FRACTION) return null
  return (expected / actualTokens) * 100
}

// Trailing-window median at each position (window capped to available history).
// Used to smooth the daily Eff line: a per-task token cost varies ~×2.5 even at
// fixed scope, so the raw daily line stays noisy; a 7-day trailing median turns
// it into a readable trend where infra changes show as level shifts.
export function rollingMedian(xs: number[], window: number): number[] {
  return xs.map((_, i) => medianOf(xs.slice(Math.max(0, i - window + 1), i + 1)))
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
  kpiSmooth: number // 7-day trailing median of kpi — the readable trend line
  quality: number | null // mean of rated scores that day, or null
  sessions: number
}

const SMOOTH_WINDOW = 7

// Group by day; token-weighted Eff and mean rated quality per day; sort by date.
// Token-weighting (Σexpected/Σactual) instead of mean-of-ratios stops a single
// tiny-token session from blowing the daily Eff up. Sessions with non-positive
// expected/actual are dropped. A 7-day trailing-median `kpiSmooth` is added.
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
  const rows: Omit<KpdDay, 'kpiSmooth'>[] = []
  for (const [date, e] of byDay) {
    if (e.n === 0 || e.act <= 0) continue
    rows.push({
      date,
      kpi: (e.exp / e.act) * 100,
      quality: e.scores.length ? e.scores.reduce((a, x) => a + x, 0) / e.scores.length : null,
      sessions: e.n,
    })
  }
  rows.sort((a, b) => a.date.localeCompare(b.date))
  const smooth = rollingMedian(
    rows.map((r) => r.kpi),
    SMOOTH_WINDOW,
  )
  return rows.map((r, i) => ({ ...r, kpiSmooth: smooth[i] }))
}
