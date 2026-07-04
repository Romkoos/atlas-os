import { useEffect, useRef } from 'react'

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

type Star = { x: number; y: number; r: number; layer: number; phase: number }
type Meteor = { x: number; y: number; vx: number; vy: number; life: number; max: number }
type Cloud = { x: number; y: number; r: number; vx: number; vy: number; hue: number; a: number }

/** Deep-space scene behind the whole app: three parallax star layers with
 * twinkle, drifting amber nebula clouds, and occasional meteors. Pure 2D
 * canvas (no GL context), DPR-capped, pauses when the window is hidden.
 * Reduced motion renders a single static frame. */
export function SpaceScene() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let w = 0
    let h = 0
    let stars: Star[] = []
    let clouds: Cloud[] = []
    const meteors: Meteor[] = []
    let raf = 0
    let running = true
    let nextMeteor = 4000 + Math.random() * 6000
    let last = performance.now()

    const seed = () => {
      w = window.innerWidth
      h = window.innerHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars = Array.from({ length: 170 }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 0.4 + Math.random() * 1.3,
        layer: 1 + Math.floor(Math.random() * 3),
        phase: Math.random() * Math.PI * 2,
      }))
      clouds = Array.from({ length: 4 }, (_, i) => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 260 + Math.random() * 340,
        vx: (Math.random() - 0.5) * 0.006,
        vy: (Math.random() - 0.5) * 0.004,
        hue: i === 0 ? 18 : 38 + Math.random() * 14, // one deep ember, rest amber
        a: 0.05 + Math.random() * 0.05,
      }))
    }

    const frame = (now: number) => {
      const dt = Math.min(now - last, 50)
      last = now
      ctx.clearRect(0, 0, w, h)

      // nebula clouds (screen-lightened radial gradients, drifting)
      ctx.globalCompositeOperation = 'lighter'
      for (const c of clouds) {
        c.x += c.vx * dt
        c.y += c.vy * dt
        if (c.x < -c.r) c.x = w + c.r
        if (c.x > w + c.r) c.x = -c.r
        if (c.y < -c.r) c.y = h + c.r
        if (c.y > h + c.r) c.y = -c.r
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.r)
        g.addColorStop(0, `oklch(0.5 0.13 ${c.hue} / ${c.a})`)
        g.addColorStop(1, 'transparent')
        ctx.fillStyle = g
        ctx.fillRect(c.x - c.r, c.y - c.r, c.r * 2, c.r * 2)
      }
      ctx.globalCompositeOperation = 'source-over'

      // stars with parallax drift + twinkle
      const t = now * 0.001
      for (const s of stars) {
        s.x -= 0.002 * s.layer * dt
        if (s.x < -2) s.x = w + 2
        const tw = 0.55 + 0.45 * Math.sin(t * (0.6 + s.layer * 0.3) + s.phase)
        ctx.globalAlpha = tw * (0.25 + s.layer * 0.18)
        ctx.fillStyle = s.layer === 3 ? 'oklch(0.9 0.06 75)' : 'oklch(0.9 0.02 250)'
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // meteors
      nextMeteor -= dt
      if (nextMeteor <= 0) {
        nextMeteor = 6000 + Math.random() * 9000
        const fromX = w * (0.2 + Math.random() * 0.7)
        meteors.push({
          x: fromX,
          y: -20,
          vx: -0.25 - Math.random() * 0.2,
          vy: 0.35 + Math.random() * 0.25,
          life: 0,
          max: 900 + Math.random() * 500,
        })
      }
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i]
        m.life += dt
        m.x += m.vx * dt
        m.y += m.vy * dt
        if (m.life > m.max) {
          meteors.splice(i, 1)
          continue
        }
        const fade = Math.sin((m.life / m.max) * Math.PI)
        const tail = 90
        const g = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * tail * 4, m.y - m.vy * tail * 4)
        g.addColorStop(0, `oklch(0.9 0.14 80 / ${0.75 * fade})`)
        g.addColorStop(1, 'transparent')
        ctx.strokeStyle = g
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(m.x, m.y)
        ctx.lineTo(m.x - m.vx * tail * 4, m.y - m.vy * tail * 4)
        ctx.stroke()
      }

      if (running && !reduced) raf = requestAnimationFrame(frame)
    }

    seed()
    if (reduced) {
      frame(performance.now()) // single static frame
    } else {
      raf = requestAnimationFrame(frame)
    }

    const onVis = () => {
      running = !document.hidden
      if (running && !reduced) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      } else {
        cancelAnimationFrame(raf)
      }
    }
    const onResize = () => {
      seed()
      if (reduced) frame(performance.now())
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div className="fx-ambient" aria-hidden>
      <canvas ref={ref} />
    </div>
  )
}
