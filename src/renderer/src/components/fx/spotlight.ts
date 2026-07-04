const SPOTLIGHT_SELECTOR = '.kpi, .rm-card, .mkt-card, .skill-item'
const TILT_SELECTOR = '.kpi, .mkt-card'

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** One passive, delegated listener drives every cursor-tracking hover effect:
 * the spotlight sheen (`--mx`/`--my`) and the 3D tilt (`--rx`/`--ry`). Keeps
 * the effects zero-churn for pages: matching a class is enough to opt in. */
export function initSpotlight(): void {
  if (window.matchMedia('(hover: none)').matches) return
  window.addEventListener(
    'pointermove',
    (e) => {
      const el = (e.target as Element).closest?.(SPOTLIGHT_SELECTOR) as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left
      const y = e.clientY - r.top
      el.style.setProperty('--mx', `${x}px`)
      el.style.setProperty('--my', `${y}px`)
      if (!reduced && el.matches(TILT_SELECTOR)) {
        const ry = ((x / r.width - 0.5) * 5).toFixed(2)
        const rx = (-(y / r.height - 0.5) * 5).toFixed(2)
        el.style.setProperty('--rx', `${rx}deg`)
        el.style.setProperty('--ry', `${ry}deg`)
      }
    },
    { passive: true },
  )
  // Reset the tilt when the pointer leaves the card.
  window.addEventListener(
    'pointerout',
    (e) => {
      const el = (e.target as Element).closest?.(TILT_SELECTOR) as HTMLElement | null
      if (!el) return
      const to = e.relatedTarget as Element | null
      if (to && el.contains(to)) return
      el.style.setProperty('--rx', '0deg')
      el.style.setProperty('--ry', '0deg')
    },
    { passive: true },
  )
}
