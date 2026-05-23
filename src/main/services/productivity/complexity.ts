// Session-level complexity from "scope" signals (files, dirs, tool types,
// skills, subagents). Each signal is percentile-ranked across the session
// corpus, then averaged and mapped to 1–10. Kept pure (no DB) so it is
// unit-testable; the tRPC layer supplies the corpus. See
// docs/superpowers/specs/2026-05-23-complexity-quality-metrics-design.md.

// Mid-rank percentile of each value within `values`, in [0,1].
// (countLess + 0.5*countEqual) / n. Single value -> 0.5. Empty -> [].
export function percentileRanks(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  return values.map((v) => {
    let less = 0
    let equal = 0
    for (const o of values) {
      if (o < v) less++
      else if (o === v) equal++
    }
    return (less + 0.5 * equal) / n
  })
}

// Mean of the per-signal percentiles -> 1..10. Empty -> 1.
export function complexityFromPercentiles(percentiles: number[]): number {
  if (percentiles.length === 0) return 1
  const mean = percentiles.reduce((s, p) => s + p, 0) / percentiles.length
  const scaled = 1 + 9 * mean
  return Math.min(10, Math.max(1, scaled))
}
