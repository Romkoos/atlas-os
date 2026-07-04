import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { useRef } from 'react'

gsap.registerPlugin(useGSAP, ScrambleTextPlugin)

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Decrypt-style text reveal. Renders the full text immediately (accessible
 * name is stable for e2e), then scrambles-in whenever `text` changes. */
export function ScrambleText({
  text,
  className,
  duration = 0.35,
}: {
  text: string
  className?: string
  duration?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useGSAP(
    () => {
      if (!ref.current || reduced) return
      gsap.to(ref.current, {
        duration,
        ease: 'none',
        scrambleText: { text, chars: 'upperCase', speed: 1.4 },
      })
    },
    { dependencies: [text], scope: ref },
  )
  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  )
}
