import { describe, expect, it } from 'vitest'
import { clusterAnchors } from './cluster-anchors'

describe('clusterAnchors', () => {
  it('returns an empty map for no keys', () => {
    expect(clusterAnchors([]).size).toBe(0)
  })

  it('places a single cluster at the origin', () => {
    const m = clusterAnchors([7])
    expect(m.size).toBe(1)
    expect(m.get('7')).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('deduplicates keys and covers every distinct key', () => {
    const m = clusterAnchors([1, 1, 2, '2', 3])
    expect([...m.keys()].sort()).toEqual(['1', '2', '3'])
  })

  it('spreads multiple clusters onto the sphere of the given radius', () => {
    const radius = 300
    const m = clusterAnchors([0, 1, 2, 3, 4], radius)
    for (const p of m.values()) {
      const mag = Math.hypot(p.x, p.y, p.z)
      expect(mag).toBeGreaterThan(radius * 0.5)
      expect(mag).toBeLessThanOrEqual(radius + 1e-6)
    }
  })

  it('is deterministic for the same input', () => {
    expect(clusterAnchors([1, 2, 3, 4])).toEqual(clusterAnchors([1, 2, 3, 4]))
  })
})
