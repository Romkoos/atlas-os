import { describe, expect, it } from 'vitest'
import { formatCountdown, formatResetClock, gaugeTone } from './subscription-gauge'

describe('formatResetClock', () => {
  it('formats weekday + 12h clock in local time', () => {
    // 2026-07-11 is a Saturday; 05:59 local.
    expect(formatResetClock(new Date(2026, 6, 11, 5, 59).getTime())).toBe('Sat 5:59 AM')
  })
  it('handles noon and midnight', () => {
    expect(formatResetClock(new Date(2026, 6, 8, 21, 0).getTime())).toBe('Wed 9:00 PM')
    expect(formatResetClock(new Date(2026, 6, 6, 0, 5).getTime())).toBe('Mon 12:05 AM')
    expect(formatResetClock(new Date(2026, 6, 6, 12, 0).getTime())).toBe('Mon 12:00 PM')
  })
})

describe('formatCountdown', () => {
  it('formats hours:minutes:seconds', () => {
    expect(formatCountdown(2 * 3600_000 + 14 * 60_000 + 9_000)).toBe('02:14:09')
  })
  it('clamps negatives to zero', () => {
    expect(formatCountdown(-500)).toBe('00:00:00')
  })
})

describe('gaugeTone', () => {
  it('is good below 0.75, warn below 0.9, else bad', () => {
    expect(gaugeTone(0.5, 'allowed')).toBe('good')
    expect(gaugeTone(0.8, 'allowed')).toBe('warn')
    expect(gaugeTone(0.95, 'allowed')).toBe('bad')
  })
  it('is always bad when rejected', () => {
    expect(gaugeTone(0.1, 'rejected')).toBe('bad')
  })
})
