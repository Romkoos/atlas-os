export interface DailyPoint {
  date: string // YYYY-MM-DD (local)
  count: number
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/** Local YYYY-MM-DD — matches SQLite `date(..., 'localtime')`. */
export function toLocalDateString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Ascending list of the last `days` local dates, ending on `today`. */
export function buildDateRange(days: number, today: Date): string[] {
  const result: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    result.push(toLocalDateString(d))
  }
  return result
}

/** Project raw per-day counts onto a zero-filled `days`-long series. */
export function fillDailySeries(
  rows: ReadonlyArray<{ day: string; count: number }>,
  days: number,
  today: Date,
): DailyPoint[] {
  const counts = new Map(rows.map((r) => [r.day, r.count]))
  return buildDateRange(days, today).map((date) => ({ date, count: counts.get(date) ?? 0 }))
}
