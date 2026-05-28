import type { Section } from '@renderer/store/ui'

// Single source of truth for the sidebar nav + title-bar breadcrumb.
// `key` doubles as the [NN] id prefix and the Cmd+N shortcut (1-based index).
export interface NavItem {
  id: Section
  key: string
  label: string
}

export const NAV: ReadonlyArray<NavItem> = [
  { id: 'dashboard', key: '01', label: 'DASHBOARD' },
  { id: 'stats', key: '02', label: 'STATS' },
  { id: 'productivity', key: '03', label: 'PRODUCTIVITY' },
  { id: 'info', key: '04', label: 'INFO' },
  { id: 'skills', key: '05', label: 'SKILLS' },
  { id: 'settings', key: '06', label: 'SETTINGS' },
]
