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
  { id: 'chats', key: '03', label: 'CHATS' },
  { id: 'stats', key: '04', label: 'STATS' },
  { id: 'productivity', key: '05', label: 'PRODUCTIVITY' },
  { id: 'knowledge', key: '06', label: 'KNOWLEDGE' },
  { id: 'news', key: '07', label: 'NEWS' },
  { id: 'signals', key: '08', label: 'SIGNALS' },
  { id: 'info', key: '09', label: 'INFO' },
  { id: 'skills', key: '10', label: 'SKILLS' },
  { id: 'plugins', key: '11', label: 'PLUGINS' },
  { id: 'settings', key: '12', label: 'SETTINGS' },
]
