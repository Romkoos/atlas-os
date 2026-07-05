# Plasma Ring Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat 4-tile KPI StatusRow on the Dashboard with a 3-column asymmetric bento where a Canvas-animated Plasma Ring occupies the center as the visual anchor, showing real-time Claude subscription utilization and countdown to reset.

**Architecture:** Pure animation helpers live in `plasma-ring.ts` (testable in Vitest); a stateless `PlasmaRing` canvas component reads them on every rAF frame via a `propsRef`; `UsagePlasmaWidget` owns the tRPC subscription, ResizeObserver, and HTML text overlay; `Dashboard.tsx` wires it all into the redesigned `StatusRow`. No new npm packages.

**Tech Stack:** React + Canvas 2D API + `requestAnimationFrame` + `ResizeObserver` + tRPC `subscriptionUsage.watch` + Vitest

## Global Constraints

- All UI strings English only.
- No new npm packages — Canvas 2D + rAF + ResizeObserver are all native browser APIs.
- `git-commit-message` skill fires for atlas-os — **ignore it**; write commit messages manually.
- Work on feature branch `feat/plasma-ring-hero` branched from `main`.
- Run `pnpm test` (Vitest) after each task that has tests; run `pnpm typecheck` before each commit.
- Linter is Biome (`pnpm lint`); it warns on `any` — use proper types.
- Canvas must account for `devicePixelRatio` (retina displays).
- Color constants must use `Math.round` before building `rgb(r,g,b)` strings to avoid fractional values.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `src/renderer/src/components/dashboard/plasma-ring.ts` | **NEW** | Pure helpers: `piecewiseLerp`, `animParams`, `ringColor`, `ringNoise` |
| `src/renderer/src/components/dashboard/plasma-ring.test.ts` | **NEW** | Vitest unit tests for all helpers |
| `src/renderer/src/components/dashboard/PlasmaRing.tsx` | **NEW** | Canvas + rAF animation; stateless visual, reads latest props via ref |
| `src/renderer/src/components/dashboard/UsagePlasmaWidget.tsx` | **NEW** | tRPC connector, ResizeObserver, countdown interval, HTML overlay |
| `src/renderer/src/pages/Dashboard.tsx` | **MODIFY** | Rewrite `StatusRow` to 3-col layout; remove `SubscriptionWidget` from rail |
| `src/renderer/src/index.css` | **MODIFY** | Add `.kpis-hero`, `.kpis-hero-side`, `.plasma-widget`, `.plasma-overlay` classes |
| `src/renderer/src/components/dashboard/SubscriptionWidget.tsx` | **KEEP, unused** | No code change — simply no longer rendered |

---

### Task 1: Pure Animation Helpers

**Files:**
- Create: `src/renderer/src/components/dashboard/plasma-ring.ts`
- Create: `src/renderer/src/components/dashboard/plasma-ring.test.ts`

**Interfaces:**
- Produces:
  - `piecewiseLerp(t: number, stops: [number, number][]): number`
  - `interface AnimParams { pulseFreq: number; jitterAmp: number; particleSpeed: number; glowIntensity: number }`
  - `animParams(utilization: number): AnimParams`
  - `ringColor(utilization: number, status: string): string` → `'rgb(r,g,b)'`
  - `ringNoise(t: number): number` → `[-1, 1]`

---

- [ ] **Step 1.1 — Create feature branch**

```bash
git checkout -b feat/plasma-ring-hero
```

- [ ] **Step 1.2 — Write the failing tests**

Create `src/renderer/src/components/dashboard/plasma-ring.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { animParams, piecewiseLerp, ringColor, ringNoise } from './plasma-ring'

describe('piecewiseLerp', () => {
  it('returns first stop value when t is below lower bound', () => {
    expect(piecewiseLerp(-1, [[0, 10], [1, 20]])).toBe(10)
  })
  it('returns last stop value when t is above upper bound', () => {
    expect(piecewiseLerp(2, [[0, 10], [1, 20]])).toBe(20)
  })
  it('interpolates linearly at midpoint of two-stop range', () => {
    expect(piecewiseLerp(0.5, [[0, 0], [1, 100]])).toBe(50)
  })
  it('lands exactly on an internal stop', () => {
    expect(piecewiseLerp(0.5, [[0, 0], [0.5, 50], [1, 100]])).toBe(50)
  })
  it('interpolates between middle stops', () => {
    // Between [0.5, 50] and [1, 100]: t=0.75 → halfway → 75
    expect(piecewiseLerp(0.75, [[0, 0], [0.5, 50], [1, 100]])).toBe(75)
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
    const g = (s: string) => parseInt(s.match(/rgb\((\d+),(\d+),(\d+)\)/)![2])
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
```

- [ ] **Step 1.3 — Run tests to confirm they fail**

```bash
pnpm test src/renderer/src/components/dashboard/plasma-ring.test.ts
```

Expected: all tests fail with "Cannot find module './plasma-ring'".

- [ ] **Step 1.4 — Implement `plasma-ring.ts`**

Create `src/renderer/src/components/dashboard/plasma-ring.ts`:

```typescript
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
  [0, 0.5], [0.5, 1.0], [0.75, 1.5], [0.9, 2.5], [1, 3.0],
]
const JITTER_STOPS: [number, number][] = [
  [0, 2], [0.5, 3], [0.75, 4], [0.9, 6], [1, 8],
]
const SPEED_STOPS: [number, number][] = [
  [0, 0.25], [0.5, 0.5], [0.75, 0.75], [0.9, 0.9], [1, 1.0],
]
const GLOW_STOPS: [number, number][] = [
  [0, 0.4], [0.5, 0.6], [0.75, 0.8], [0.9, 1.0], [1, 1.0],
]

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
    u <= 0.75
      ? lerpRgb(C_GOOD, C_WARN, u / 0.75)
      : lerpRgb(C_WARN, C_BAD, (u - 0.75) / 0.25)
  return `rgb(${rgb.map(Math.round).join(',')})`
}

// ── Noise ─────────────────────────────────────────────────────────────────────

/**
 * Simple two-frequency sinusoidal noise for the ring jitter.
 * Returns a value in [-1, 1].
 */
export function ringNoise(t: number): number {
  return 0.6 * Math.sin(t * 2.3) + 0.4 * Math.sin(t * 5.7)
}
```

- [ ] **Step 1.5 — Run tests to confirm they pass**

```bash
pnpm test src/renderer/src/components/dashboard/plasma-ring.test.ts
```

Expected: all 14 tests pass.

- [ ] **Step 1.6 — Typecheck and commit**

```bash
pnpm typecheck
git add src/renderer/src/components/dashboard/plasma-ring.ts \
        src/renderer/src/components/dashboard/plasma-ring.test.ts
git commit -m "feat/plasma-ring: pure animation helpers + tests"
```

---

### Task 2: PlasmaRing Canvas Component

**Files:**
- Create: `src/renderer/src/components/dashboard/PlasmaRing.tsx`

**Interfaces:**
- Consumes:
  - `animParams(utilization: number): AnimParams` from `./plasma-ring`
  - `ringColor(utilization: number, status: string): string` from `./plasma-ring`
  - `ringNoise(t: number): number` from `./plasma-ring`
- Produces:
  - `export function PlasmaRing(props: PlasmaRingProps): JSX.Element`
  - `interface PlasmaRingProps { utilization: number; status: string; isIdle: boolean; width: number; height: number }`

No unit tests (Canvas API is unavailable in Vitest's node environment).

---

- [ ] **Step 2.1 — Create PlasmaRing.tsx**

Create `src/renderer/src/components/dashboard/PlasmaRing.tsx`:

```typescript
import { useEffect, useRef } from 'react'
import { animParams, ringColor, ringNoise } from './plasma-ring'

export interface PlasmaRingProps {
  /** 0–1 fraction of subscription window consumed. */
  utilization: number
  /** Raw SDK status string: 'allowed' | 'allowed_warning' | 'rejected'. */
  status: string
  /** True when no rate_limit_event has been received yet (no data). */
  isIdle: boolean
  /** Logical width in CSS px. */
  width: number
  /** Logical height in CSS px. */
  height: number
}

interface Particle {
  /** Position along the arc in radians, relative to arc start (0 = start of arc). */
  angle: number
  /** Recent angle history for trail rendering. */
  trail: number[]
}

const PARTICLE_COUNT = 10
const TRAIL_LEN = 8
const TRAIL_SPEED = 1.5 // radians per second at particleSpeed=1

function initParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    angle: ((i / PARTICLE_COUNT) * Math.PI * 2 * 0.8), // spread across 80% of arc
    trail: [],
  }))
}

/**
 * Canvas-animated plasma ring visualization.
 * All animation state lives in refs so React never re-renders on frame;
 * latest props are read via propsRef inside the rAF loop.
 */
export function PlasmaRing({ utilization, status, isIdle, width, height }: PlasmaRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Animation state — mutated in-place inside rAF, never triggers React renders.
  const stateRef = useRef({
    raf: 0,
    t: 0,
    lastTime: 0,
    idleAngle: -Math.PI / 2,
    particles: initParticles(),
  })

  // Always-current props snapshot read by the rAF loop.
  const propsRef = useRef({ utilization, status, isIdle })
  propsRef.current = { utilization, status, isIdle }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Retina: scale internal pixel buffer by DPR.
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.scale(dpr, dpr)

    const state = stateRef.current

    function frame(timestamp: number) {
      const dt = state.lastTime === 0 ? 0 : (timestamp - state.lastTime) / 1000
      state.lastTime = timestamp
      state.t += dt

      const { utilization: util, status: st, isIdle: idle } = propsRef.current
      const params = animParams(util)
      const color = ringColor(util, st)

      const cx = width / 2
      const cy = height / 2
      const radius = Math.min(width, height) * 0.38

      ctx.clearRect(0, 0, width, height)

      // 1. Track ring — ghost of the full circle.
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'
      ctx.lineWidth = 8
      ctx.stroke()

      if (idle) {
        // ── Idle: slowly rotating 25% arc, no particles, low glow. ──────────
        state.idleAngle += dt * 0.4
        const start = state.idleAngle
        const end = start + Math.PI * 0.5

        ctx.shadowColor = color
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(cx, cy, radius, start, end)
        ctx.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ',0.35)')
        ctx.lineWidth = 10
        ctx.stroke()
        ctx.shadowBlur = 0
      } else {
        // ── Active: full plasma animation. ───────────────────────────────────
        const jitter = ringNoise(state.t * 3) * params.jitterAmp
        const r = radius + jitter
        const startAngle = -Math.PI / 2
        const endAngle = startAngle + util * Math.PI * 2

        // 7. Outer corona — multiple dim arcs at increasing radii.
        for (let i = 3; i >= 1; i--) {
          ctx.beginPath()
          ctx.arc(cx, cy, r + i * 5, startAngle, endAngle)
          ctx.strokeStyle = color
            .replace('rgb(', 'rgba(')
            .replace(')', `,${0.04 * (4 - i)})`)
          ctx.lineWidth = 2
          ctx.stroke()
        }

        // 2. Main arc.
        ctx.shadowColor = color
        ctx.shadowBlur = 20 + params.glowIntensity * 20
        ctx.beginPath()
        ctx.arc(cx, cy, r, startAngle, endAngle)
        ctx.strokeStyle = color
        ctx.lineWidth = 10
        ctx.stroke()
        ctx.shadowBlur = 0

        // 3. Leading-edge bloom at arc tip.
        const tipX = cx + r * Math.cos(endAngle)
        const tipY = cy + r * Math.sin(endAngle)
        const bloomR = 16 + params.glowIntensity * 14
        const bloom = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, bloomR)
        bloom.addColorStop(
          0,
          color.replace('rgb(', 'rgba(').replace(')', `,${0.9 * params.glowIntensity})`),
        )
        bloom.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(tipX, tipY, bloomR, 0, Math.PI * 2)
        ctx.fillStyle = bloom
        ctx.fill()

        // 6. Inner core pulse — central radial gradient that breathes.
        const pulseMag = (Math.sin(state.t * params.pulseFreq * Math.PI * 2) * 0.5 + 0.5)
        const coreAlpha = pulseMag * util * params.glowIntensity * 0.3
        const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.72)
        core.addColorStop(
          0,
          color.replace('rgb(', 'rgba(').replace(')', `,${coreAlpha})`),
        )
        core.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.beginPath()
        ctx.arc(cx, cy, radius * 0.72, 0, Math.PI * 2)
        ctx.fillStyle = core
        ctx.fill()

        // 5. Orbital particles — only rendered when there's meaningful arc.
        if (util > 0.04) {
          const maxAngle = util * Math.PI * 2
          for (const p of state.particles) {
            p.angle += params.particleSpeed * TRAIL_SPEED * dt
            if (p.angle > maxAngle) p.angle = 0

            const absAngle = startAngle + p.angle

            // Trail
            p.trail.push(p.angle)
            if (p.trail.length > TRAIL_LEN) p.trail.shift()

            for (let i = 0; i < p.trail.length; i++) {
              const ta = startAngle + p.trail[i]
              const tx = cx + r * Math.cos(ta)
              const ty = cy + r * Math.sin(ta)
              const alpha = (i / p.trail.length) * 0.5 * params.glowIntensity
              ctx.beginPath()
              ctx.arc(tx, ty, 2, 0, Math.PI * 2)
              ctx.fillStyle = color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`)
              ctx.fill()
            }

            // Dot
            const px = cx + r * Math.cos(absAngle)
            const py = cy + r * Math.sin(absAngle)
            ctx.beginPath()
            ctx.arc(px, py, 2.5, 0, Math.PI * 2)
            ctx.fillStyle = color
            ctx.fill()
          }
        }

        // Rejected: red flash overlay.
        if (st === 'rejected') {
          const flashAlpha = Math.max(0, Math.sin(state.t * 3 * Math.PI * 2)) * 0.1
          ctx.fillStyle = `rgba(218,60,48,${flashAlpha})`
          ctx.fillRect(0, 0, width, height)
        }
      }

      state.raf = requestAnimationFrame(frame)
    }

    state.lastTime = 0
    state.raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(state.raf)
      state.lastTime = 0
    }
  }, [width, height])

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block', pointerEvents: 'none' }}
    />
  )
}
```

- [ ] **Step 2.2 — Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 2.3 — Commit**

```bash
git add src/renderer/src/components/dashboard/PlasmaRing.tsx
git commit -m "feat/plasma-ring: canvas animation component"
```

---

### Task 3: UsagePlasmaWidget + CSS

**Files:**
- Create: `src/renderer/src/components/dashboard/UsagePlasmaWidget.tsx`
- Modify: `src/renderer/src/index.css`

**Interfaces:**
- Consumes:
  - `PlasmaRing` + `PlasmaRingProps` from `./PlasmaRing`
  - `gaugeTone`, `formatCountdown` from `./subscription-gauge`
  - `trpc.subscriptionUsage.watch` (tRPC subscription, returns `{ info: RateLimitInfo | null; plan: string }`)
  - `RateLimitInfo` from `@shared/ipc-events`
- Produces:
  - `export function UsagePlasmaWidget(): JSX.Element`
    (no props; subscribes to tRPC internally)

---

- [ ] **Step 3.1 — Add CSS classes to `src/renderer/src/index.css`**

Find the `.kpis.bento` block (around line 801) and add the new classes **after** the existing `.kpi .delta.dn` block (around line 881). Insert before the existing `/* Traveling border shine */` comment:

```css
/* ── PLASMA RING HERO ──────────────────────────────────────────────────────── */
/* 3-column asymmetric bento: [stats | plasma ring | stats].
   Replaces .kpis.bento for the main StatusRow. */
.kpis-hero {
  display: grid;
  grid-template-columns: 1fr 1.6fr 1fr;
  gap: 1px;
  background: var(--line-dim);    /* hairline dividers between columns */
  border: 1px solid var(--line-dim);
  box-shadow:
    inset 0 1px 0 oklch(1 0 0 / 0.05),
    0 14px 44px oklch(0 0 0 / 0.45);
}

/* Left/right vertical stacks — each holds two equal-height kpi tiles. */
.kpis-hero-side {
  display: grid;
  grid-template-rows: 1fr 1fr;
  gap: 1px;
  background: var(--line-dim);    /* hairline divider between top/bottom */
  min-width: 0;
}

/* Tiles inside side stacks need their own bg (parent bg is --line-dim for hairlines)
   and must not add a right border (the gap hairline handles separation). */
.kpis-hero-side .kpi {
  background: var(--bg);
  border-right: 0;
}

/* The top tile of each side stack is the "featured" one — bump font a little. */
.kpis-hero-side .kpi:first-child .val {
  font-size: 36px;
}

/* Center plasma ring container. */
.plasma-widget {
  position: relative;
  min-height: 220px;
  background: var(--bg);
  display: flex;
  align-items: stretch;
}

.plasma-widget canvas {
  display: block;
  width: 100% !important;
  height: 100% !important;
}

/* HTML text overlay — sits above the canvas, pointer-events off so canvas
   interactions (if any) aren't blocked. */
.plasma-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}

.plasma-pct {
  font-family: var(--mono);
  font-size: 42px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: var(--amber);
}
.plasma-pct.good {
  color: #86e07c;
}
.plasma-pct.bad {
  color: var(--warn);
}

.plasma-reset-label {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-3);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-top: 8px;
}

.plasma-countdown {
  font-family: var(--mono);
  font-size: 20px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-2);
  line-height: 1.2;
}

.plasma-meta {
  font-family: var(--mono);
  font-size: 10px;
  color: var(--fg-4);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-top: 2px;
}
```

- [ ] **Step 3.2 — Create UsagePlasmaWidget.tsx**

Create `src/renderer/src/components/dashboard/UsagePlasmaWidget.tsx`:

```typescript
import { formatCountdown, gaugeTone } from '@renderer/components/dashboard/subscription-gauge'
import { trpc } from '@renderer/lib/trpc'
import type { RateLimitInfo } from '@shared/ipc-events'
import { useEffect, useRef, useState } from 'react'
import { PlasmaRing } from './PlasmaRing'

/**
 * Center jewel of the KPI hero band.
 * Subscribes to live subscription-usage updates, measures its container,
 * and renders a Canvas plasma ring with an HTML text overlay.
 */
export function UsagePlasmaWidget() {
  const [snap, setSnap] = useState<{ info: RateLimitInfo | null; plan: string } | null>(null)
  trpc.subscriptionUsage.watch.useSubscription(undefined, {
    onData: (d) => setSnap(d),
  })

  // Client-side 1 s countdown tick.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Measure container for responsive canvas sizing.
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 200, h: 200 })
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.max(1, Math.round(width)), h: Math.max(1, Math.round(height)) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const info = snap?.info ?? null
  const isIdle = info === null
  const util = info?.utilization ?? 0
  const status = info?.status ?? 'allowed'
  const tone = gaugeTone(util, status)
  const remaining = info?.resetsAt != null ? info.resetsAt - now : null
  const plan = snap?.plan ?? ''
  const rateType = info?.rateLimitType ?? ''

  return (
    <div className="plasma-widget" ref={containerRef}>
      <PlasmaRing
        utilization={util}
        status={status}
        isIdle={isIdle}
        width={size.w}
        height={size.h}
      />

      <div className="plasma-overlay" aria-label={isIdle ? 'awaiting data' : `${Math.round(util * 100)}% usage`}>
        <div className={`plasma-pct${tone === 'good' ? ' good' : tone === 'bad' ? ' bad' : ''}`}>
          {isIdle ? '—%' : `${Math.round(util * 100)}%`}
        </div>

        {!isIdle && (
          <>
            <div className="plasma-reset-label">
              {status === 'rejected' ? 'limit reached' : 'resets in'}
            </div>
            <div className="plasma-countdown">
              {remaining != null ? formatCountdown(remaining) : 'window open'}
            </div>
            {(plan || rateType) && (
              <div className="plasma-meta">
                {[plan, rateType].filter(Boolean).join(' · ')}
              </div>
            )}
          </>
        )}

        {isIdle && (
          <div className="plasma-reset-label">awaiting data</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3.3 — Typecheck**

```bash
pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3.4 — Commit**

```bash
git add src/renderer/src/components/dashboard/UsagePlasmaWidget.tsx \
        src/renderer/src/index.css
git commit -m "feat/plasma-ring: UsagePlasmaWidget component + CSS"
```

---

### Task 4: StatusRow Rewrite + Rail Cleanup

**Files:**
- Modify: `src/renderer/src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes:
  - `UsagePlasmaWidget` from `@renderer/components/dashboard/UsagePlasmaWidget`
- No new exports — this task only modifies the existing `StatusRow` function and the `.dash-rail` section.

---

- [ ] **Step 4.1 — Update imports in Dashboard.tsx**

In `src/renderer/src/pages/Dashboard.tsx`, add the import for `UsagePlasmaWidget` and remove the `SubscriptionWidget` import:

Find:
```typescript
import { SubscriptionWidget } from '@renderer/components/dashboard/SubscriptionWidget'
```

Replace with:
```typescript
import { UsagePlasmaWidget } from '@renderer/components/dashboard/UsagePlasmaWidget'
```

- [ ] **Step 4.2 — Rewrite StatusRow**

Find the entire `StatusRow` function (lines ~88–148) and replace it:

```typescript
function StatusRow() {
  const today = trpc.productivity.today.useQuery({})
  const kpi = trpc.productivity.kpi.useQuery({ days: 30 })
  const summary = trpc.stats.summary.useQuery()

  const t = today.data?.totals
  const byDay = kpi.data?.byDay ?? []
  const sessions30d = byDay.reduce((s, d) => s + d.sessions, 0)
  const tokens30d = byDay.reduce((s, d) => s + d.tokens, 0)
  const trend =
    byDay.length >= 2 ? byDay[byDay.length - 1].kpiSmooth - byDay[0].kpiSmooth : null

  return (
    <div className="kpis-hero">
      {/* ── Left stack: TODAY TOKENS + TOKEN EFFICIENCY ────────────────────── */}
      <div className="kpis-hero-side">
        <div className="kpi">
          <div className="label">
            <span className="id">[01]</span>TODAY TOKENS
          </div>
          <div className="val amber">{t ? <Ticker value={t.totalTokens} /> : '—'}</div>
          <div className="delta">
            {t ? `${num(t.turns)} turns · ${num(t.activeHours)} active hrs` : 'no activity yet'}
          </div>
        </div>

        <div className="kpi" style={{ position: 'relative' }}>
          <div
            className="fx-gauge"
            style={{ '--val': Math.max(0, Math.min(140, kpi.data?.overall ?? 0)) } as CSSProperties}
            aria-hidden
          />
          <div className="label">
            <span className="id">[02]</span>TOKEN EFFICIENCY
          </div>
          <div className="val amber">{pct(kpi.data?.overall)}</div>
          <div className={`delta${trend == null ? '' : trend >= 0 ? ' up' : ' dn'}`}>
            {trend == null
              ? 'vs baseline'
              : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend).toFixed(0)} pts · 30d`}
          </div>
        </div>
      </div>

      {/* ── Center: Plasma Ring ─────────────────────────────────────────────── */}
      <UsagePlasmaWidget />

      {/* ── Right stack: SESSIONS 30D + AGENT RUNS ─────────────────────────── */}
      <div className="kpis-hero-side">
        <div className="kpi">
          <div className="label">
            <span className="id">[03]</span>SESSIONS · 30D
          </div>
          <div className="val">{kpi.data ? <Ticker value={sessions30d} /> : '—'}</div>
          <div className="delta">{kpi.data ? `${compact(tokens30d)} tokens` : 'last 30 days'}</div>
        </div>

        <div className="kpi">
          <div className="label">
            <span className="id">[04]</span>AGENT RUNS
          </div>
          <div className="val">{summary.data ? <Ticker value={summary.data.total} /> : '—'}</div>
          <div className="delta">
            {summary.data ? `avg ${fmtDuration(summary.data.avgDurationMs)}` : 'all time'}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4.3 — Remove SubscriptionWidget from the rail**

In the `Dashboard` render function, find the `.dash-rail` section (~lines 455–469):

```tsx
<div className="dash-rail">
  <div className="dash-reveal" style={{ '--i': 4 } as CSSProperties}>
    <TokenHeatmap />
  </div>
  <div className="dash-reveal" style={{ '--i': 5 } as CSSProperties}>
    <KnowledgePulse />
  </div>
  <div className="dash-reveal" style={{ '--i': 6 } as CSSProperties}>
    <BenchmarkWidget />
  </div>
  <div className="dash-reveal" style={{ '--i': 7 } as CSSProperties}>
    <SubscriptionWidget />
  </div>
</div>
```

Replace with (remove the `SubscriptionWidget` slot; renumber `--i` for `dash-reveal` items that follow):

```tsx
<div className="dash-rail">
  <div className="dash-reveal" style={{ '--i': 4 } as CSSProperties}>
    <TokenHeatmap />
  </div>
  <div className="dash-reveal" style={{ '--i': 5 } as CSSProperties}>
    <KnowledgePulse />
  </div>
  <div className="dash-reveal" style={{ '--i': 6 } as CSSProperties}>
    <BenchmarkWidget />
  </div>
</div>
```

Also update the `--i` values on subsequent `dash-reveal` wrappers after the hero row (currently `8`, `9`, `10`) — decrement by 1 to `7`, `8`, `9`:

```tsx
<div className="dash-mid mt-16">
  <div className="dash-reveal" style={{ '--i': 7 } as CSSProperties}>
    <ActivityPanel />
  </div>
  <div className="dash-reveal" style={{ '--i': 8 } as CSSProperties}>
    <SignalsPanel />
  </div>
</div>

<div className="dash-reveal mt-16" style={{ '--i': 9 } as CSSProperties}>
  <ProcessesStrip />
</div>
```

- [ ] **Step 4.4 — Typecheck + lint**

```bash
pnpm typecheck && pnpm lint
```

Expected: no type errors. Lint may warn about pre-existing `any` in unrelated files — those are not introduced by this change and can be ignored.

- [ ] **Step 4.5 — Run all tests**

```bash
pnpm test
```

Expected: all tests pass (no regressions).

- [ ] **Step 4.6 — Commit**

```bash
git add src/renderer/src/pages/Dashboard.tsx
git commit -m "feat/plasma-ring: StatusRow 3-col bento + rail cleanup"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec requirement | Covered by |
|---|---|
| 3-column `1fr 1.6fr 1fr` bento layout | Task 4 (CSS `.kpis-hero`) + Task 3 CSS |
| Left column: TODAY TOKENS + TOKEN EFFICIENCY stacked | Task 4 StatusRow |
| Center: Plasma Ring full height | Task 3 `UsagePlasmaWidget` |
| Right column: SESSIONS 30D + AGENT RUNS stacked | Task 4 StatusRow |
| Canvas layers: track, arc, bloom, jitter, particles, core, corona | Task 2 `PlasmaRing` |
| Continuous parameter interpolation | Task 1 `animParams` + `piecewiseLerp` |
| Color lerp amber→orange→red | Task 1 `ringColor` |
| DPR retina scaling | Task 2 `useEffect` canvas setup |
| `min-height: 220px` on plasma-widget | Task 3 CSS |
| HTML overlay: %, countdown, plan·type | Task 3 `UsagePlasmaWidget` |
| Idle state (no data): rotating dim arc | Task 2 `PlasmaRing` idle branch |
| Rejected state: full red arc + flash | Task 2 `PlasmaRing` rejected flash |
| `ResizeObserver` for responsive canvas | Task 3 `UsagePlasmaWidget` |
| tRPC `subscriptionUsage.watch` subscription | Task 3 `UsagePlasmaWidget` |
| 1-second countdown interval | Task 3 `UsagePlasmaWidget` |
| `SubscriptionWidget` removed from rail | Task 4 |
| `gaugeTone` + `formatCountdown` reused | Task 3 imports |
| No new npm packages | ✓ (Canvas 2D + rAF + ResizeObserver all native) |
