import { useEffect, useRef, useState } from 'react'

// Small "?" affixed to a chart title. Click toggles a terminal-styled card with
// the metric definition. Closes on Escape or outside-click. No external dep.
export function InfoPopover({ label, body }: { label: string; body: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label={`What is ${label}?`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          fontFamily: 'var(--mono)',
          fontSize: 10,
          lineHeight: '14px',
          width: 16,
          height: 16,
          border: '1px solid var(--color-border)',
          color: open ? 'var(--amber)' : 'var(--fg-4)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        ?
      </button>
      {open ? (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            top: 20,
            left: 0,
            zIndex: 10,
            width: 240,
            background: 'var(--color-popover)',
            border: '1px solid var(--color-border)',
            padding: '8px 10px',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            lineHeight: 1.6,
            color: 'var(--color-popover-foreground)',
          }}
        >
          <div style={{ color: 'var(--amber)', marginBottom: 4 }}>{label}</div>
          <div style={{ color: 'var(--fg-3)' }}>{body}</div>
        </div>
      ) : null}
    </span>
  )
}
