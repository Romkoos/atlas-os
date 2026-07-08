import { describe, expect, it } from 'vitest'
import { clampSplitRatio } from './splitRatio'

describe('clampSplitRatio', () => {
  it('passes through a mid ratio', () => {
    expect(clampSplitRatio(0.5, 1000, 360)).toBe(0.5)
  })
  it('clamps so the left pane keeps its minimum', () => {
    // minPx/container = 0.36 → 0.1 is too small
    expect(clampSplitRatio(0.1, 1000, 360)).toBeCloseTo(0.36, 5)
  })
  it('clamps so the right pane keeps its minimum', () => {
    expect(clampSplitRatio(0.95, 1000, 360)).toBeCloseTo(0.64, 5)
  })
  it('centres when the container is too narrow for two minimums', () => {
    expect(clampSplitRatio(0.9, 600, 360)).toBe(0.5)
  })
})
