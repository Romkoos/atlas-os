// Contribution-grid bucketing for the dashboard token heatmap. kpi.byDay is
// sparse (active days only, local 'YYYY-MM-DD' keys), so the grid densifies it
// into a full trailing window; intensity is relative to the window max.
export interface HeatCell {
  date: string
  tokens: number
  level: 0 | 1 | 2 | 3 | 4
}

export function levelOf(tokens: number, max: number): HeatCell['level'] {
  if (tokens <= 0 || max <= 0) return 0
  const f = tokens / max
  if (f <= 0.25) return 1
  if (f <= 0.5) return 2
  if (f <= 0.75) return 3
  return 4
}

// Local-time date key, matching the backend's per-day bucketing.
const keyOf = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function heatmapCells(
  byDay: Array<{ date: string; tokens: number }>,
  days: number,
  end: Date,
): HeatCell[] {
  const tokensByDate = new Map(byDay.map((d) => [d.date, d.tokens]))
  const max = byDay.reduce((m, d) => Math.max(m, d.tokens), 0)
  const cells: HeatCell[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(d.getDate() - i)
    const date = keyOf(d)
    const tokens = tokensByDate.get(date) ?? 0
    cells.push({ date, tokens, level: levelOf(tokens, max) })
  }
  return cells
}
