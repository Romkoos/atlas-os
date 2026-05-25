const DAY_MS = 24 * 60 * 60 * 1000

export interface TimeWindow {
  lo: number // inclusive lower bound (epoch ms)
  hi: number | null // exclusive upper bound; null = "up to now" (no cap)
}

// Bounds for a `days`-wide range optionally shifted back by `offset` days.
// offset = 0 → [now - days, now) with hi = null (unbounded top = current behavior).
// offset = days → the immediately-preceding period, used for compare overlays.
export function windowBounds(days: number, offset = 0, now: number = Date.now()): TimeWindow {
  return {
    lo: now - (days + offset) * DAY_MS,
    hi: offset > 0 ? now - offset * DAY_MS : null,
  }
}
