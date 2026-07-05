import { describe, expect, it } from 'vitest'
import { formatCountdown, gaugeTone } from './subscription-gauge'

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
