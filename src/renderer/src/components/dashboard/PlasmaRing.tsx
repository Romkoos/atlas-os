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
    angle: (i / PARTICLE_COUNT) * Math.PI * 2 * 0.8, // spread across 80% of arc
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
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d')
    if (ctx === null) return
    // ctx is narrowed to CanvasRenderingContext2D for the rest of this effect scope,
    // but TypeScript cannot track narrowing into a nested function closure, so we
    // capture it in a non-null typed alias used throughout frame().
    const c: CanvasRenderingContext2D = ctx

    // Retina: scale internal pixel buffer by DPR.
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    c.scale(dpr, dpr)

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

      c.clearRect(0, 0, width, height)

      // 1. Track ring — ghost of the full circle.
      c.beginPath()
      c.arc(cx, cy, radius, 0, Math.PI * 2)
      c.strokeStyle = 'rgba(255,255,255,0.07)'
      c.lineWidth = 8
      c.stroke()

      if (idle) {
        // ── Idle: slowly rotating 25% arc, no particles, low glow. ──────────
        state.idleAngle += dt * 0.4
        const start = state.idleAngle
        const end = start + Math.PI * 0.5

        c.shadowColor = color
        c.shadowBlur = 10
        c.beginPath()
        c.arc(cx, cy, radius, start, end)
        c.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', ',0.35)')
        c.lineWidth = 10
        c.stroke()
        c.shadowBlur = 0
      } else {
        // ── Active: full plasma animation. ───────────────────────────────────
        const jitter = ringNoise(state.t * 3) * params.jitterAmp
        const r = radius + jitter
        const startAngle = -Math.PI / 2
        const endAngle = startAngle + util * Math.PI * 2

        // 7. Outer corona — multiple dim arcs at increasing radii.
        for (let i = 3; i >= 1; i--) {
          c.beginPath()
          c.arc(cx, cy, r + i * 5, startAngle, endAngle)
          c.strokeStyle = color.replace('rgb(', 'rgba(').replace(')', `,${0.04 * (4 - i)})`)
          c.lineWidth = 2
          c.stroke()
        }

        // 2. Main arc.
        c.shadowColor = color
        c.shadowBlur = 20 + params.glowIntensity * 20
        c.beginPath()
        c.arc(cx, cy, r, startAngle, endAngle)
        c.strokeStyle = color
        c.lineWidth = 10
        c.stroke()
        c.shadowBlur = 0

        // 3. Leading-edge bloom at arc tip.
        const tipX = cx + r * Math.cos(endAngle)
        const tipY = cy + r * Math.sin(endAngle)
        const bloomR = 16 + params.glowIntensity * 14
        const bloom = c.createRadialGradient(tipX, tipY, 0, tipX, tipY, bloomR)
        bloom.addColorStop(
          0,
          color.replace('rgb(', 'rgba(').replace(')', `,${0.9 * params.glowIntensity})`),
        )
        bloom.addColorStop(1, 'rgba(0,0,0,0)')
        c.beginPath()
        c.arc(tipX, tipY, bloomR, 0, Math.PI * 2)
        c.fillStyle = bloom
        c.fill()

        // 6. Inner core pulse — central radial gradient that breathes.
        const pulseMag = Math.sin(state.t * params.pulseFreq * Math.PI * 2) * 0.5 + 0.5
        const coreAlpha = pulseMag * util * params.glowIntensity * 0.3
        const core = c.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.72)
        core.addColorStop(0, color.replace('rgb(', 'rgba(').replace(')', `,${coreAlpha})`))

        core.addColorStop(1, 'rgba(0,0,0,0)')
        c.beginPath()
        c.arc(cx, cy, radius * 0.72, 0, Math.PI * 2)
        c.fillStyle = core
        c.fill()

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
              c.beginPath()
              c.arc(tx, ty, 2, 0, Math.PI * 2)
              c.fillStyle = color.replace('rgb(', 'rgba(').replace(')', `,${alpha})`)
              c.fill()
            }

            // Dot
            const px = cx + r * Math.cos(absAngle)
            const py = cy + r * Math.sin(absAngle)
            c.beginPath()
            c.arc(px, py, 2.5, 0, Math.PI * 2)
            c.fillStyle = color
            c.fill()
          }
        }

        // Rejected: red flash overlay.
        if (st === 'rejected') {
          const flashAlpha = Math.max(0, Math.sin(state.t * 3 * Math.PI * 2)) * 0.1
          c.fillStyle = `rgba(218,60,48,${flashAlpha})`
          c.fillRect(0, 0, width, height)
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
    <canvas ref={canvasRef} style={{ width, height, display: 'block', pointerEvents: 'none' }} />
  )
}
