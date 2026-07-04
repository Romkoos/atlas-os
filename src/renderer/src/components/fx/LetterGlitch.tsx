import { useEffect, useRef } from 'react'

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const GLYPHS = 'ABCDEF0123456789▸▪◦·░▒#$%&@ATLAS'

/** Matrix-style random glyph field for empty states: a dim grid of mono
 * characters where a few cells flicker to new glyphs each frame. Fills its
 * positioned parent; renders one static field under reduced motion. */
export function LetterGlitch({ opacity = 0.14 }: { opacity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const parent = canvas.parentElement
    if (!parent) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const cell = 16
    let cols = 0
    let rows = 0
    let grid: string[] = []
    let raf = 0
    let running = true
    let acc = 0
    let last = performance.now()

    const rand = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]

    const size = () => {
      const w = parent.clientWidth
      const h = parent.clientHeight
      canvas.width = w * dpr
      canvas.height = h * dpr
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.ceil(w / cell)
      rows = Math.ceil(h / cell)
      grid = Array.from({ length: cols * rows }, rand)
    }

    const draw = () => {
      ctx.clearRect(0, 0, cols * cell, rows * cell)
      ctx.font = '11px "Geist Mono", monospace'
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const bright = Math.random() < 0.02
          ctx.fillStyle = bright ? 'oklch(0.8 0.17 75 / 0.7)' : 'oklch(0.6 0.03 250 / 0.5)'
          ctx.fillText(grid[r * cols + c], c * cell, r * cell + 11)
        }
      }
    }

    const frame = (now: number) => {
      const dt = now - last
      last = now
      acc += dt
      if (acc > 90) {
        acc = 0
        // flicker a handful of cells
        for (let i = 0; i < Math.max(4, (cols * rows) / 60); i++) {
          grid[Math.floor(Math.random() * grid.length)] = rand()
        }
        draw()
      }
      if (running && !reduced) raf = requestAnimationFrame(frame)
    }

    size()
    draw()
    if (!reduced) raf = requestAnimationFrame(frame)

    const onVis = () => {
      running = !document.hidden
      if (running && !reduced) {
        last = performance.now()
        raf = requestAnimationFrame(frame)
      } else {
        cancelAnimationFrame(raf)
      }
    }
    const ro = new ResizeObserver(() => {
      size()
      draw()
    })
    ro.observe(parent)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  return <canvas ref={ref} className="fx-letterglitch" style={{ opacity }} aria-hidden />
}
