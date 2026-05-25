import { describe, expect, it } from 'vitest'
import { windowBounds } from './window'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

describe('windowBounds', () => {
  it('offset 0 → lower bound `days` back, no upper bound', () => {
    expect(windowBounds(30, 0, NOW)).toEqual({ lo: NOW - 30 * DAY, hi: null })
  })

  it('offset shifts the whole window back and adds an upper bound', () => {
    expect(windowBounds(30, 30, NOW)).toEqual({ lo: NOW - 60 * DAY, hi: NOW - 30 * DAY })
  })

  it('previous window abuts the current window with no gap or overlap', () => {
    const cur = windowBounds(7, 0, NOW)
    const prev = windowBounds(7, 7, NOW)
    expect(prev.hi).toBe(cur.lo) // prev ends exactly where current begins
  })

  it('defaults: offset 0, now = Date.now()', () => {
    const before = Date.now()
    const w = windowBounds(7)
    const after = Date.now()
    expect(w.hi).toBeNull()
    expect(w.lo).toBeGreaterThanOrEqual(before - 7 * DAY)
    expect(w.lo).toBeLessThanOrEqual(after - 7 * DAY)
  })
})
