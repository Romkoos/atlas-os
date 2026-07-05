import { describe, expect, it } from 'vitest'
import { parseResetToMs, parseUsageWindows } from './usagePoll'

const SAMPLE = `You are currently using your subscription to power your Claude Code usage

Current session: 70% used · resets Jul 5 at 3:30pm (Asia/Jerusalem)
Current week (all models): 28% used · resets Jul 8 at 9pm (Asia/Jerusalem)
Current week (Fable): 36% used · resets Jul 8 at 9pm (Asia/Jerusalem)

What's contributing to your limits usage?`

// Fixed "now" for deterministic reset-date parsing: 2026-07-05T10:00 local.
const NOW = new Date(2026, 6, 5, 10, 0, 0).getTime()

describe('parseUsageWindows', () => {
  it('returns every window in order with converted units', () => {
    const windows = parseUsageWindows(SAMPLE, NOW)
    expect(windows.map((w) => w.label)).toEqual(['session', 'week', 'week · Fable'])
    expect(windows[0]).toEqual({
      label: 'session',
      status: 'allowed',
      utilization: 0.7,
      resetsAt: new Date(2026, 6, 5, 15, 30, 0).getTime(),
    })
    expect(windows[1].utilization).toBeCloseTo(0.28)
    expect(windows[2].utilization).toBeCloseTo(0.36)
  })

  it('derives per-window status (>=100 rejected, >=90 warning)', () => {
    const text = `Current session: 100% used · resets Jul 5 at 3:30pm (Asia/Jerusalem)
Current week (all models): 93% used · resets Jul 8 at 9pm (Asia/Jerusalem)`
    const windows = parseUsageWindows(text, NOW)
    expect(windows[0].status).toBe('rejected')
    expect(windows[1].status).toBe('allowed_warning')
  })

  it('returns [] when no usage lines are present', () => {
    expect(parseUsageWindows('no data here', NOW)).toEqual([])
    expect(parseUsageWindows('', NOW)).toEqual([])
  })
})

describe('parseResetToMs', () => {
  it('parses "MMM D at h:mmam/pm" in local time', () => {
    expect(parseResetToMs('Jul 5 at 3:30pm (Asia/Jerusalem)', NOW)).toBe(
      new Date(2026, 6, 5, 15, 30, 0).getTime(),
    )
  })

  it('parses an hour with no minutes', () => {
    expect(parseResetToMs('Jul 8 at 9pm (Asia/Jerusalem)', NOW)).toBe(
      new Date(2026, 6, 8, 21, 0, 0).getTime(),
    )
  })

  it('handles 12am/12pm correctly', () => {
    expect(parseResetToMs('Jul 6 at 12am', NOW)).toBe(new Date(2026, 6, 6, 0, 0, 0).getTime())
    expect(parseResetToMs('Jul 6 at 12pm', NOW)).toBe(new Date(2026, 6, 6, 12, 0, 0).getTime())
  })

  it('rolls to next year when the date would otherwise be far in the past', () => {
    const decNow = new Date(2026, 11, 31, 23, 0, 0).getTime()
    expect(parseResetToMs('Jan 2 at 9am', decNow)).toBe(new Date(2027, 0, 2, 9, 0, 0).getTime())
  })

  it('returns undefined for an unparseable string', () => {
    expect(parseResetToMs('whenever', NOW)).toBeUndefined()
  })
})
