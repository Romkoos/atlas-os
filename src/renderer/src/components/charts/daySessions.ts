// Day-scoped helpers for the click→drawer drilldown.

// Local YYYY-MM-DD for a Date/ISO string, matching the chart's
// date(ts,'unixepoch','localtime') keys. null/invalid in → null out.
// (Not unit-tested: output is timezone-dependent. Verified via the app run.)
export function localDay(d: Date | string | null): string | null {
  if (d == null) return null
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-CA') // 'YYYY-MM-DD' in local tz
}

// True if `day` (YYYY-MM-DD) falls within [start, end] inclusive. A null bound
// is open-ended; both null → false (the session can't be placed on a calendar).
export function inDayRange(day: string, start: string | null, end: string | null): boolean {
  if (start == null && end == null) return false
  if (start != null && day < start) return false
  if (end != null && day > end) return false
  return true
}

export interface DaySessionLite {
  totalTokens: number
  kpi: number | null
  project: string
}

export interface DaySummary {
  count: number
  totalTokens: number
  avgKpi: number | null
  byProject: { project: string; tokens: number; sessions: number }[]
}

// Aggregate a day's sessions: count, total tokens, mean of non-null Eff, and a
// per-project breakdown sorted by tokens desc.
export function summarizeDay(sessions: ReadonlyArray<DaySessionLite>): DaySummary {
  let totalTokens = 0
  const kpis: number[] = []
  const proj = new Map<string, { tokens: number; sessions: number }>()
  for (const s of sessions) {
    totalTokens += s.totalTokens
    if (s.kpi != null) kpis.push(s.kpi)
    const p = proj.get(s.project) ?? { tokens: 0, sessions: 0 }
    p.tokens += s.totalTokens
    p.sessions += 1
    proj.set(s.project, p)
  }
  const avgKpi = kpis.length ? kpis.reduce((a, x) => a + x, 0) / kpis.length : null
  const byProject = [...proj.entries()]
    .map(([project, v]) => ({ project, tokens: v.tokens, sessions: v.sessions }))
    .sort((a, b) => b.tokens - a.tokens)
  return { count: sessions.length, totalTokens, avgKpi, byProject }
}
