// Shared Signal types for the unified event log. Plain structurally-cloneable
// shapes — they cross the electron-trpc IPC boundary with no transformer, so
// timestamps are epoch ms (numbers), never Date objects.

export type SignalSeverity = 'info' | 'success' | 'warning' | 'error'
export type SignalLinkKind = 'section' | 'path'

// Known emitters. `source` is a free-form text column, but these are the
// subsystems that write signals today and the filter chips on the Signals page.
export const SIGNAL_SOURCES = ['jobs', 'infra', 'roadmap', 'chat', 'news'] as const
export type SignalSource = (typeof SIGNAL_SOURCES)[number]

export const SIGNAL_SEVERITIES: readonly SignalSeverity[] = ['info', 'success', 'warning', 'error']

// A signal as seen by the renderer.
export interface SignalView {
  id: number
  source: string
  type: string
  severity: SignalSeverity
  title: string
  detail: string | null
  link: string | null
  linkKind: SignalLinkKind | null
  createdAt: number // epoch ms
  readAt: number | null // epoch ms, null = unread
}

// Live payload streamed over signals.list: the newest N signals plus the total
// unread count (drives the dashboard feed, the nav badge, and toasts).
export interface SignalsSnapshot {
  signals: SignalView[]
  unreadCount: number
}
