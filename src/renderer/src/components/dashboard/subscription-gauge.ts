// Pure helpers for SubscriptionWidget (kept separate so they are unit-testable).
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

export type GaugeTone = 'good' | 'warn' | 'bad'
export function gaugeTone(utilization: number, status: string): GaugeTone {
  if (status === 'rejected') return 'bad'
  if (utilization >= 0.9) return 'bad'
  if (utilization >= 0.75) return 'warn'
  return 'good'
}
