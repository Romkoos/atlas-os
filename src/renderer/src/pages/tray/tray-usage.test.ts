import type { UsageWindow } from '@shared/ipc-events'
import { describe, expect, it } from 'vitest'
import { pickTrayUsage, utilPct } from './tray-usage'

const w = (label: string, utilization: number): UsageWindow => ({
  label,
  status: 'allowed',
  utilization,
})

describe('pickTrayUsage', () => {
  it('picks the session and week windows by label', () => {
    const { session, week } = pickTrayUsage([w('session', 0.4), w('week', 0.2)])
    expect(session?.utilization).toBe(0.4)
    expect(week?.utilization).toBe(0.2)
  })

  it('falls back to a week-prefixed label (e.g. "week · Fable")', () => {
    const { week } = pickTrayUsage([w('session', 0.1), w('week · Fable', 0.7)])
    expect(week?.label).toBe('week · Fable')
  })

  it('returns nulls when a window is absent', () => {
    const { session, week } = pickTrayUsage([])
    expect(session).toBeNull()
    expect(week).toBeNull()
  })
})

describe('utilPct', () => {
  it('renders a rounded percentage', () => {
    expect(utilPct(w('session', 0.436))).toBe('44%')
  })

  it('clamps overage to 100%', () => {
    expect(utilPct(w('session', 1.4))).toBe('100%')
  })

  it('shows a dash for a missing window', () => {
    expect(utilPct(null)).toBe('—')
  })
})
