import { describe, expect, it } from 'vitest'
import { heatmapCells, levelOf } from './heatmap'

describe('levelOf', () => {
  it('is 0 for zero tokens or zero max', () => {
    expect(levelOf(0, 100)).toBe(0)
    expect(levelOf(50, 0)).toBe(0)
  })
  it('buckets by quarter of max', () => {
    expect(levelOf(10, 100)).toBe(1)
    expect(levelOf(25, 100)).toBe(1)
    expect(levelOf(26, 100)).toBe(2)
    expect(levelOf(50, 100)).toBe(2)
    expect(levelOf(75, 100)).toBe(3)
    expect(levelOf(100, 100)).toBe(4)
  })
})

describe('heatmapCells', () => {
  it('densifies a sparse byDay into a full calendar window ending at `end`', () => {
    const end = new Date(2026, 6, 4) // July 4 2026, local
    const cells = heatmapCells([{ date: '2026-07-03', tokens: 40 }], 3, end)
    expect(cells.map((c) => c.date)).toEqual(['2026-07-02', '2026-07-03', '2026-07-04'])
    expect(cells.map((c) => c.tokens)).toEqual([0, 40, 0])
    expect(cells.map((c) => c.level)).toEqual([0, 4, 0])
  })
  it('handles an empty byDay (all zero levels)', () => {
    const cells = heatmapCells([], 2, new Date(2026, 0, 10))
    expect(cells).toHaveLength(2)
    expect(cells.every((c) => c.level === 0)).toBe(true)
  })
})
