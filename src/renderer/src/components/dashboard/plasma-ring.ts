/**
 * Pure animation helpers for PlasmaRing.
 * No DOM dependencies — fully unit-testable.
 */

// ── Interpolation ─────────────────────────────────────────────────────────────

/**
 * Piecewise-linear interpolation over [x, y] breakpoints.
 * `t` is clamped to [stops[0][0], stops[last][0]].
 * Stops must be sorted ascending by x.
 */
export function piecewiseLerp(t: number, stops: [number, number][]): number {
  const clamped = Math.max(stops[0][0], Math.min(stops[stops.length - 1][0], t))
  for (let i = 0; i < stops.length - 1; i++) {
    const [x0, y0] = stops[i]
    const [x1, y1] = stops[i + 1]
    if (clamped <= x1) {
      const p = (clamped - x0) / (x1 - x0)
      return y0 + (y1 - y0) * p
    }
  }
  return stops[stops.length - 1][1]
}

// ── Animation parameters ───────────────────────────────────────────────────────

export interface AnimParams {
  /** Pulse frequency in Hz (how fast the inner core breathes). */
  pulseFreq: number
  /** Ring radius jitter amplitude in logical px. */
  jitterAmp: number
  /** Normalized particle orbit speed, 0–1. */
  particleSpeed: number
  /** Glow/bloom intensity scalar, 0–1. */
  glowIntensity: number
}

const PULSE_STOPS: [number, number][] = [
  [0, 0.5],
  [0.5, 1.0],
  [0.75, 1.5],
  [0.9, 2.5],
  [1, 3.0],
]
const JITTER_STOPS: [number, number][] = [
  [0, 2],
  [0.5, 3],
  [0.75, 4],
  [0.9, 6],
  [1, 8],
]
const SPEED_STOPS: [number, number][] = [
  [0, 0.25],
  [0.5, 0.5],
  [0.75, 0.75],
  [0.9, 0.9],
  [1, 1.0],
]
const GLOW_STOPS: [number, number][] = [
  [0, 0.4],
  [0.5, 0.6],
  [0.75, 0.8],
  [0.9, 1.0],
  [1, 1.0],
]

/**
 * How strongly a ring should pulse, 0–1. Pulsation only appears above 50%
 * utilization and ramps to full at 100% — calmer rings stay steady.
 */
export function pulseStrength(utilization: number): number {
  if (utilization <= 0.5) return 0
  return Math.min(1, (utilization - 0.5) / 0.5)
}

/** Continuously-interpolated animation parameters for a given utilization (0–1). */
export function animParams(utilization: number): AnimParams {
  return {
    pulseFreq: piecewiseLerp(utilization, PULSE_STOPS),
    jitterAmp: piecewiseLerp(utilization, JITTER_STOPS),
    particleSpeed: piecewiseLerp(utilization, SPEED_STOPS),
    glowIntensity: piecewiseLerp(utilization, GLOW_STOPS),
  }
}

// ── Color ─────────────────────────────────────────────────────────────────────

// RGB triplets matching the app palette:
//   good  → --amber  oklch(0.80 0.17 75)
//   warn  → orange   oklch(0.75 0.20 55)
//   bad   → red      oklch(0.70 0.25 25)
const C_GOOD: [number, number, number] = [212, 152, 45]
const C_WARN: [number, number, number] = [220, 115, 20]
const C_BAD: [number, number, number] = [218, 60, 48]

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/**
 * Returns `'rgb(r,g,b)'` interpolated good→warn→bad.
 * `status === 'rejected'` short-circuits to full red regardless of utilization.
 */
export function ringColor(utilization: number, status: string): string {
  if (status === 'rejected') return `rgb(${C_BAD.map(Math.round).join(',')})`
  const u = Math.max(0, Math.min(1, utilization))
  const rgb =
    u <= 0.75 ? lerpRgb(C_GOOD, C_WARN, u / 0.75) : lerpRgb(C_WARN, C_BAD, (u - 0.75) / 0.25)
  return `rgb(${rgb.map(Math.round).join(',')})`
}

// Type-keyed colors for the weekly widget's two concentric rings. Unlike the
// session ring (amber→red by utilization), these encode the *window type* so the
// two rings are visually distinct: week (all models) = sky, week (Fable) = violet.
const C_WEEK: [number, number, number] = [56, 189, 248]
const C_FABLE: [number, number, number] = [167, 139, 250]

export function typeColor(type: 'week' | 'fable'): string {
  const c = type === 'fable' ? C_FABLE : C_WEEK
  return `rgb(${c.join(',')})`
}

// ── Noise ─────────────────────────────────────────────────────────────────────

/**
 * Simple two-frequency sinusoidal noise for the ring jitter.
 * Returns a value in [-1, 1].
 */
export function ringNoise(t: number): number {
  return 0.6 * Math.sin(t * 2.3) + 0.4 * Math.sin(t * 5.7)
}
