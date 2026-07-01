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
  { id: 'roadmap', key: '02', label: 'ROADMAP' },
  { id: 'stats', key: '03', label: 'STATS' },
  { id: 'productivity', key: '04', label: 'PRODUCTIVITY' },
  { id: 'knowledge', key: '05', label: 'KNOWLEDGE' },
  { id: 'news', key: '06', label: 'NEWS' },
  { id: 'info', key: '07', label: 'INFO' },
  { id: 'skills', key: '08', label: 'SKILLS' },
  { id: 'plugins', key: '09', label: 'PLUGINS' },
  { id: 'settings', key: '10', label: 'SETTINGS' },
]
