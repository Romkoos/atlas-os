import { useEffect, useRef } from 'react'
import { animParams, pulseStrength, ringNoise } from './plasma-ring'

/** One concentric ring to render. Colors are pre-resolved by the caller. */
export interface RingSpec {
  /** 0–1 fraction consumed (clamped by the caller). */
  utilization: number
  /** Resolved 'rgb(r,g,b)' stroke color for this ring. */
  color: string
  /** Ring radius as a fraction of min(width,height). Default 0.38. */
  radiusScale?: number
  /** Arc stroke width in px. Default 9. */
  lineWidth?: number
  /** Render orbital particles on this ring. Default true. */
  particles?: boolean
}

export interface PlasmaRingProps {
  /** One or more concentric rings, outer→inner. */
  rings: RingSpec[]
  /** True when no data yet — shows the idle sweep. */
  isIdle: boolean
  /** Red flash overlay (e.g. a window is rejected / over limit). */
  flash?: boolean
  width: number
  height: number
}

interface Particle {
  angle: number
  trail: number[]
}

const PARTICLE_COUNT = 8
const TRAIL_LEN = 8
const TRAIL_SPEED = 1.5 // radians per second at particleSpeed=1

function initParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    angle: (i / PARTICLE_COUNT) * Math.PI * 2 * 0.8,
    trail: [],
  }))
}

const withAlpha = (rgb: string, a: number) => rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`)

/**
 * Canvas-animated plasma ring(s). All animation state lives in refs so React
 * never re-renders on frame; latest props are read via propsRef inside the rAF
 * loop. Renders each ring's track (a faint full circle that breathes in sync with
 * the arc so it doesn't look static at high utilization), arc, corona, tip bloom
 * and orbital particles.
 */
export function PlasmaRing({ rings, isIdle, flash, width, height }: PlasmaRingProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const stateRef = useRef({
    raf: 0,
    t: 0,
    lastTime: 0,
    idleAngle: -Math.PI / 2,
    ringParticles: [] as Particle[][],
  })

  const propsRef = useRef({ rings, isIdle, flash })
  propsRef.current = { rings, isIdle, flash }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx: CanvasRenderingContext2D | null = canvas.getContext('2d')
    if (ctx === null) return
    const c: CanvasRenderingContext2D = ctx

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    c.scale(dpr, dpr)

    const state = stateRef.current

    function frame(timestamp: number) {
      const dt = state.lastTime === 0 ? 0 : (timestamp - state.lastTime) / 1000
      state.lastTime = timestamp
      state.t += dt

      const { rings: ringSpecs, isIdle: idle, flash: doFlash } = propsRef.current
      const cx = width / 2
      const cy = height / 2
      const base = Math.min(width, height)

      c.clearRect(0, 0, width, height)

      if (idle || ringSpecs.length === 0) {
        // ── Idle: slowly rotating 25% arc, no particles, low glow. ──────────
        const radius = base * 0.38
        c.beginPath()
        c.arc(cx, cy, radius, 0, Math.PI * 2)
        c.strokeStyle = 'rgba(255,255,255,0.07)'
        c.lineWidth = 8
        c.stroke()

        state.idleAngle += dt * 0.4
        const color = ringSpecs[0]?.color ?? 'rgb(212,152,45)'
        c.shadowColor = color
        c.shadowBlur = 10
        c.beginPath()
        c.arc(cx, cy, radius, state.idleAngle, state.idleAngle + Math.PI * 0.5)
        c.strokeStyle = withAlpha(color, 0.35)
        c.lineWidth = 10
        c.stroke()
        c.shadowBlur = 0
        state.raf = requestAnimationFrame(frame)
        return
      }

      // Keep a particle set per ring.
      if (state.ringParticles.length !== ringSpecs.length) {
        state.ringParticles = ringSpecs.map(() => initParticles())
      }

      // Core pulse once, from the highest-utilization ring — only visible when
      // that ring is above the 50% pulse threshold.
      const maxUtil = Math.max(...ringSpecs.map((r) => r.utilization))
      const coreParams = animParams(maxUtil)
      const coreOsc = Math.sin(state.t * coreParams.pulseFreq * Math.PI * 2) * 0.5 + 0.5
      const corePulse = pulseStrength(maxUtil) * coreOsc
      const coreRadius = base * (ringSpecs[0].radiusScale ?? 0.38) * 0.72
      const coreAlpha = corePulse * maxUtil * coreParams.glowIntensity * 0.3
      if (coreAlpha > 0.001) {
        const core = c.createRadialGradient(cx, cy, 0, cx, cy, coreRadius)
        core.addColorStop(0, withAlpha(ringSpecs[0].color, coreAlpha))
        core.addColorStop(1, 'rgba(0,0,0,0)')
        c.beginPath()
        c.arc(cx, cy, coreRadius, 0, Math.PI * 2)
        c.fillStyle = core
        c.fill()
      }

      ringSpecs.forEach((ring, ri) => {
        const util = ring.utilization
        const params = animParams(util)
        // Oscillating pulse contribution, gated to >50% and ramping with util.
        // Each ring pulses at its own frequency/phase; calmer rings stay steady.
        const ringOsc = Math.sin(state.t * params.pulseFreq * Math.PI * 2) * 0.5 + 0.5
        const pulse = pulseStrength(util)
        const pc = pulse * ringOsc
        const lineWidth = ring.lineWidth ?? 9
        const baseRadius = base * (ring.radiusScale ?? 0.38)
        // Track ring — breathes only when this ring pulses; otherwise static.
        const trackAlpha = 0.07 + pc * 0.06
        c.shadowColor = ring.color
        c.shadowBlur = pc * params.glowIntensity * 8
        c.beginPath()
        c.arc(cx, cy, baseRadius, 0, Math.PI * 2)
        c.strokeStyle = `rgba(255,255,255,${trackAlpha})`
        c.lineWidth = Math.max(2, lineWidth - 2)
        c.stroke()
        c.shadowBlur = 0

        // Radius jitter only wobbles once the ring is pulsing (>50%).
        const jitter = ringNoise(state.t * 3 + ri) * params.jitterAmp * pulse
        const r = baseRadius + jitter
        const startAngle = -Math.PI / 2
        const endAngle = startAngle + util * Math.PI * 2

        // Outer corona.
        for (let i = 3; i >= 1; i--) {
          c.beginPath()
          c.arc(cx, cy, r + i * 4, startAngle, endAngle)
          c.strokeStyle = withAlpha(ring.color, 0.04 * (4 - i))
          c.lineWidth = 2
          c.stroke()
        }

        // Main arc — steady base glow plus an extra pulse above 50%.
        c.shadowColor = ring.color
        c.shadowBlur = 12 + params.glowIntensity * 8 + pc * 14
        c.beginPath()
        c.arc(cx, cy, r, startAngle, endAngle)
        c.strokeStyle = ring.color
        c.lineWidth = lineWidth
        c.stroke()
        c.shadowBlur = 0

        // Leading-edge bloom.
        const tipX = cx + r * Math.cos(endAngle)
        const tipY = cy + r * Math.sin(endAngle)
        const bloomR = 14 + params.glowIntensity * 12
        const bloom = c.createRadialGradient(tipX, tipY, 0, tipX, tipY, bloomR)
        bloom.addColorStop(0, withAlpha(ring.color, 0.9 * params.glowIntensity))
        bloom.addColorStop(1, 'rgba(0,0,0,0)')
        c.beginPath()
        c.arc(tipX, tipY, bloomR, 0, Math.PI * 2)
        c.fillStyle = bloom
        c.fill()

        // Orbital particles.
        if ((ring.particles ?? true) && util > 0.04) {
          const maxAngle = util * Math.PI * 2
          for (const p of state.ringParticles[ri]) {
            p.angle += params.particleSpeed * TRAIL_SPEED * dt
            if (p.angle > maxAngle) {
              p.angle = 0
              p.trail.length = 0
            }
            p.trail.push(p.angle)
            if (p.trail.length > TRAIL_LEN) p.trail.shift()
            for (let i = 0; i < p.trail.length; i++) {
              const ta = startAngle + p.trail[i]
              const alpha = (i / p.trail.length) * 0.5 * params.glowIntensity
              c.beginPath()
              c.arc(cx + r * Math.cos(ta), cy + r * Math.sin(ta), 2, 0, Math.PI * 2)
              c.fillStyle = withAlpha(ring.color, alpha)
              c.fill()
            }
            const absAngle = startAngle + p.angle
            c.beginPath()
            c.arc(cx + r * Math.cos(absAngle), cy + r * Math.sin(absAngle), 2.5, 0, Math.PI * 2)
            c.fillStyle = ring.color
            c.fill()
          }
        }
      })

      if (doFlash) {
        const flashAlpha = Math.max(0, Math.sin(state.t * 3 * Math.PI * 2)) * 0.1
        c.fillStyle = `rgba(218,60,48,${flashAlpha})`
        c.fillRect(0, 0, width, height)
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
