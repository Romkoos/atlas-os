// Pure helpers for SubscriptionWidget (kept separate so they are unit-testable).
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// Under a day → show a live countdown; a day or more out → show an absolute
// weekday/time (like the Claude app's "Resets Sat 5:59 AM").
export const RESET_COUNTDOWN_THRESHOLD_MS = 24 * 60 * 60 * 1000

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Absolute reset time in the machine's local timezone, formatted like Claude's
// UI: "Sat 5:59 AM" (weekday, 12-hour clock, no leading zero on the hour).
export function formatResetClock(resetsAt: number): string {
  const d = new Date(resetsAt)
  const weekday = WEEKDAYS[d.getDay()]
  const ampm = d.getHours() >= 12 ? 'PM' : 'AM'
  const hour = d.getHours() % 12 || 12
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${weekday} ${hour}:${min} ${ampm}`
}

export type GaugeTone = 'good' | 'warn' | 'bad'
export function gaugeTone(utilization: number, status: string): GaugeTone {
  if (status === 'rejected') return 'bad'
  if (utilization >= 0.9) return 'bad'
  if (utilization >= 0.75) return 'warn'
  return 'good'
}
