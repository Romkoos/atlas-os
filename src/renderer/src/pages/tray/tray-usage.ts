import type { UsageWindow } from '@shared/ipc-events'

// Pick the 5h session + 7d week windows for the compact HUD readout. Week falls
// back to any 'week…'-prefixed label (e.g. per-model 'week · Fable') so the HUD
// still shows a weekly figure when the plain 'week' line isn't present.
export function pickTrayUsage(windows: UsageWindow[]): {
  session: UsageWindow | null
  week: UsageWindow | null
} {
  const session = windows.find((v) => v.label === 'session') ?? null
  const week =
    windows.find((v) => v.label === 'week') ??
    windows.find((v) => v.label.startsWith('week')) ??
    null
  return { session, week }
}

// 0–1 utilization → clamped whole-percent string; '—' when the window is absent.
export function utilPct(w: UsageWindow | null): string {
  if (w == null) return '—'
  const clamped = Math.min(1, Math.max(0, w.utilization))
  return `${Math.round(clamped * 100)}%`
}
