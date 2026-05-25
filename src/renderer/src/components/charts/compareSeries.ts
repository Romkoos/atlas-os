// Pure helpers for Phase-2 chart interactions.

// Union of every date across the daily sources, ascending and deduped. Both
// daily charts build their rows over this single axis so a shared <Brush> maps
// 1:1 (identical index → identical date on each chart).
export function dailyDateAxis(
  ...sources: ReadonlyArray<ReadonlyArray<{ date: string }>>
): string[] {
  const set = new Set<string>()
  for (const src of sources) for (const row of src) set.add(row.date)
  return [...set].sort()
}

// Overlay a previous-period series onto current rows positionally: prev[i] is
// written to rows[i][key]. Index alignment per the compare design — the earlier
// period is drawn on the current x-axis. Missing/extra entries become null; a
// real 0 is preserved (?? only replaces null/undefined).
export function overlayPrevious<T extends object>(
  rows: ReadonlyArray<T>,
  key: string,
  prev: ReadonlyArray<number | null>,
): Array<T & Record<string, number | null>> {
  return rows.map((row, i) => ({ ...row, [key]: prev[i] ?? null }))
}
