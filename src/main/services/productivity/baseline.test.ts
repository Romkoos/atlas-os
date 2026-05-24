import { type ScopedSession, selectBaselineSamples } from '@main/services/productivity/baseline'
import { describe, expect, it } from 'vitest'

const s = (id: string, lastTs: number): ScopedSession => ({
  id,
  difficulty: null,
  tokens: 1000,
  score: null,
  lastTs,
})

describe('selectBaselineSamples', () => {
  it('returns [] for empty input', () => {
    expect(selectBaselineSamples([])).toEqual([])
  })
  it('uses all sessions when fewer than the minimum', () => {
    const rows = [s('a', 1), s('b', 2), s('c', 3)]
    expect(selectBaselineSamples(rows)).toHaveLength(3)
  })
  it('takes the earliest max(15, 25%) when plentiful', () => {
    const rows = Array.from({ length: 100 }, (_, i) => s(`x${i}`, i))
    const picked = selectBaselineSamples(rows)
    expect(picked).toHaveLength(25) // ceil(0.25*100)
    expect(picked[0].id).toBe('x0')
    expect(picked.at(-1)?.id).toBe('x24')
  })
  it('floors at 15 when 25% is smaller', () => {
    const rows = Array.from({ length: 40 }, (_, i) => s(`x${i}`, i))
    expect(selectBaselineSamples(rows)).toHaveLength(15) // max(15, 10)
  })
})
