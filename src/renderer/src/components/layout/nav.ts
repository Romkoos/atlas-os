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
  { id: 'knowledge', key: '04', label: 'KNOWLEDGE' },
  { id: 'news', key: '05', label: 'NEWS' },
  { id: 'signals', key: '06', label: 'SIGNALS' },
  { id: 'skills', key: '07', label: 'SKILLS' },
  { id: 'plugins', key: '08', label: 'PLUGINS' },
  { id: 'settings', key: '09', label: 'SETTINGS' },
]
