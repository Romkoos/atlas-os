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
