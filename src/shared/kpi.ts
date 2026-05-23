// KPI = efficiency: useful output (quality × complexity) per token spent.
// Pure math, shared by the tRPC router (main), the Productivity page (renderer),
// and unit tests. See docs/superpowers/specs/2026-05-23-kpd-efficiency-metric-design.md

/** Imputed quality for sessions the user has not rated (1–10 scale midpoint). */
export const UNRATED_SCORE = 5.5

const TOKENS_PER_UNIT = 1_000_000 // KPI is expressed per 1M tokens

/** Minimal per-session shape KPI needs. `score` null = unrated. */
export interface KpiInput {
  score: number | null
  complexity: number | null
  tokens: number
}

/** A KPI input tagged with the local calendar day it belongs to (YYYY-MM-DD). */
export interface KpiSession extends KpiInput {
  day: string
}

const usable = (s: KpiInput): s is KpiInput & { complexity: number } =>
  s.complexity != null && s.tokens > 0
const quality = (score: number | null): number => score ?? UNRATED_SCORE

// Token-weighted KPI over a set of sessions: Σ(q × complexity) / (Σ tokens / 1M).
// q = score ?? 5.5. Skips sessions with null complexity or non-positive tokens.
// Returns null when no usable tokens remain.
export function kpiWindow(sessions: KpiInput[]): number | null {
  let sumQC = 0
  let sumTok = 0
  for (const s of sessions) {
    if (!usable(s)) continue
    sumQC += quality(s.score) * s.complexity
    sumTok += s.tokens
  }
  return sumTok > 0 ? sumQC / (sumTok / TOKENS_PER_UNIT) : null
}

/** KPI of a single session (null if not computable). */
export function kpiSession(
  score: number | null,
  complexity: number | null,
  tokens: number,
): number | null {
  return kpiWindow([{ score, complexity, tokens }])
}

export interface KpiDay {
  date: string
  kpi: number
  sessions: number
  tokens: number
}

// Group sessions by day, token-weight KPI within each day, sort ascending by date.
// Days whose sessions are all unusable are dropped.
export function kpiByDay(sessions: KpiSession[]): KpiDay[] {
  const byDay = new Map<string, KpiSession[]>()
  for (const s of sessions) {
    const arr = byDay.get(s.day) ?? []
    arr.push(s)
    byDay.set(s.day, arr)
  }
  const out: KpiDay[] = []
  for (const [date, list] of byDay) {
    const kpi = kpiWindow(list)
    if (kpi == null) continue
    const used = list.filter(usable)
    out.push({
      date,
      kpi,
      sessions: used.length,
      tokens: used.reduce((t, s) => t + s.tokens, 0),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}
