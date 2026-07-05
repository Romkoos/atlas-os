import { describe, expect, it } from 'vitest'
import {
  animParams,
  piecewiseLerp,
  pulseStrength,
  ringColor,
  ringNoise,
  typeColor,
} from './plasma-ring'

describe('pulseStrength', () => {
  it('is zero at or below 50% and ramps to 1 at 100%', () => {
    expect(pulseStrength(0)).toBe(0)
    expect(pulseStrength(0.5)).toBe(0)
    expect(pulseStrength(0.75)).toBeCloseTo(0.5)
    expect(pulseStrength(1)).toBe(1)
    expect(pulseStrength(1.2)).toBe(1)
  })
})

describe('typeColor', () => {
  it('returns distinct type-keyed colors for the weekly rings', () => {
    expect(typeColor('week')).toBe('rgb(56,189,248)')
    expect(typeColor('fable')).toBe('rgb(167,139,250)')
    expect(typeColor('week')).not.toBe(typeColor('fable'))
  })
})

describe('piecewiseLerp', () => {
  it('returns first stop value when t is below lower bound', () => {
    expect(
      piecewiseLerp(-1, [
        [0, 10],
        [1, 20],
      ]),
    ).toBe(10)
  })
  it('returns last stop value when t is above upper bound', () => {
    expect(
      piecewiseLerp(2, [
        [0, 10],
        [1, 20],
      ]),
    ).toBe(20)
  })
  it('interpolates linearly at midpoint of two-stop range', () => {
    expect(
      piecewiseLerp(0.5, [
        [0, 0],
        [1, 100],
      ]),
    ).toBe(50)
  })
  it('lands exactly on an internal stop', () => {
    expect(
      piecewiseLerp(0.5, [
        [0, 0],
        [0.5, 50],
        [1, 100],
      ]),
    ).toBe(50)
  })
  it('interpolates between middle stops', () => {
    // Between [0.5, 50] and [1, 100]: t=0.75 → halfway → 75
    expect(
      piecewiseLerp(0.75, [
        [0, 0],
        [0.5, 50],
        [1, 100],
      ]),
    ).toBe(75)
  })
})

describe('animParams', () => {
  it('returns minimum values at utilization 0', () => {
    const p = animParams(0)
    expect(p.pulseFreq).toBeCloseTo(0.5)
    expect(p.jitterAmp).toBeCloseTo(2)
    expect(p.particleSpeed).toBeCloseTo(0.25)
    expect(p.glowIntensity).toBeCloseTo(0.4)
  })
  it('returns maximum values at utilization 1', () => {
    const p = animParams(1)
    expect(p.pulseFreq).toBeCloseTo(3.0)
    expect(p.jitterAmp).toBeCloseTo(8)
    expect(p.particleSpeed).toBeCloseTo(1.0)
    expect(p.glowIntensity).toBeCloseTo(1.0)
  })
  it('clamps out-of-range values', () => {
    expect(animParams(-1)).toEqual(animParams(0))
    expect(animParams(2)).toEqual(animParams(1))
  })
  it('pulseFreq increases monotonically with utilization', () => {
    const vals = [0, 0.25, 0.5, 0.75, 0.9, 1.0].map((u) => animParams(u).pulseFreq)
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1])
    }
  })
  it('glowIntensity increases monotonically with utilization', () => {
    const vals = [0, 0.25, 0.5, 0.75, 0.9, 1.0].map((u) => animParams(u).glowIntensity)
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i]).toBeGreaterThanOrEqual(vals[i - 1])
    }
  })
})

describe('ringColor', () => {
  it('returns an rgb() string', () => {
    expect(ringColor(0.5, 'allowed')).toMatch(/^rgb\(\d+,\d+,\d+\)$/)
  })
  it('equals pure amber at utilization 0', () => {
    expect(ringColor(0, 'allowed')).toBe('rgb(212,152,45)')
  })
  it('equals pure red when status is rejected regardless of utilization', () => {
    expect(ringColor(0, 'rejected')).toBe('rgb(218,60,48)')
    expect(ringColor(0.5, 'rejected')).toBe('rgb(218,60,48)')
  })
  it('shifts green channel down (more red) as utilization increases', () => {
    const low = ringColor(0.1, 'allowed')
    const high = ringColor(0.95, 'allowed')
    const g = (s: string) => parseInt(s.match(/rgb\((\d+),(\d+),(\d+)\)/)?.[2] ?? '0', 10)
    expect(g(high)).toBeLessThan(g(low))
  })
})

describe('ringNoise', () => {
  it('returns values in [-1, 1] for any input', () => {
    for (let t = 0; t < 20; t += 0.17) {
      const v = ringNoise(t)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })
  it('is not constant (varies over time)', () => {
    const values = new Set([0, 1, 2, 3, 4, 5].map((t) => Math.round(ringNoise(t) * 100)))
    expect(values.size).toBeGreaterThan(1)
  })
})
