import type * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { clampSplitRatio } from './splitRatio'

interface SplitPaneProps {
  ratio: number
  onRatioChange: (r: number) => void
  left: React.ReactNode
  right: React.ReactNode
  minPx?: number
}

// Two horizontal panes with a draggable vertical gutter. The ratio is the left
// pane's fraction of the container width; the parent owns/persists it. Both
// panes keep a pixel minimum (clampSplitRatio). Keyboard: arrows nudge ±2%.
export function SplitPane({ ratio, onRatioChange, left, right, minPx = 360 }: SplitPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const ratioRef = useRef(ratio)
  ratioRef.current = ratio

  const applyFromClientX = useCallback(
    (clientX: number) => {
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const raw = (clientX - rect.left) / rect.width
      onRatioChange(clampSplitRatio(raw, rect.width, minPx))
    },
    [onRatioChange, minPx],
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return
      e.preventDefault()
      applyFromClientX(e.clientX)
    }
    const onUp = () => {
      draggingRef.current = false
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [applyFromClientX])

  // Unmount-only safety net: if we unmount mid-drag, release the flag and the
  // text-selection lock. Empty deps → runs the cleanup only on unmount.
  useEffect(() => {
    return () => {
      if (draggingRef.current) {
        draggingRef.current = false
        document.body.style.userSelect = ''
      }
    }
  }, [])

  // Re-clamp on container resize so a persisted ratio never violates min widths.
  // Reads the latest ratio via a ref rather than depending on `ratio` directly,
  // so the observer isn't torn down and recreated on every drag-driven update.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      onRatioChange(clampSplitRatio(ratioRef.current, el.getBoundingClientRect().width, minPx))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [onRatioChange, minPx])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') onRatioChange(ratio - 0.02)
    else if (e.key === 'ArrowRight') onRatioChange(ratio + 0.02)
  }

  return (
    <div className="split-pane" ref={rootRef}>
      <div className="split-left" style={{ flexBasis: `${ratio * 100}%` }}>
        {left}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: <hr> can't be focusable/draggable; this is the interactive WAI-ARIA window-splitter pattern */}
      <div
        className="split-gutter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panes"
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={(e) => {
          draggingRef.current = true
          document.body.style.userSelect = 'none'
          applyFromClientX(e.clientX)
        }}
        onKeyDown={onKeyDown}
      />
      <div className="split-right">{right}</div>
    </div>
  )
}
