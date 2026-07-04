import { type Section, useUiStore } from '@renderer/store/ui'
import type { ReactNode } from 'react'

const fmtInt = new Intl.NumberFormat('en-US')
export const num = (n: number): string => fmtInt.format(n)
export const pct = (v: number | null | undefined, digits = 0): string =>
  v == null ? '—' : `${v.toFixed(digits)}%`

// Compact token count: 12_345 → "12.3k", 1_200_000 → "1.2M".
export function compact(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// Date/ISO timestamp/epoch-ms → "2h ago". Renderer-side relative time (Date.now
// is fine here — the ban only applies to workflow scripts). Dates cross IPC as
// either real Date objects or strings, so accept both.
export function timeAgo(value: Date | string | number | null | undefined): string {
  if (!value) return 'never'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return '—'
  const min = Math.round((Date.now() - then) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

// Mono "// message" line for per-widget empty/loading states.
export function Note({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-4)', padding: '8px 0' }}
    >
      <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
      {children}
    </div>
  )
}

// "→ section" affordance in a panel head; switches the active page.
export function DrillLink({ to, label }: { to: Section; label: string }) {
  const go = useUiStore((s) => s.setSection)
  return (
    <button
      type="button"
      className="meta"
      onClick={() => go(to)}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontFamily: 'var(--mono)',
        padding: 0,
      }}
    >
      {label} →
    </button>
  )
}
