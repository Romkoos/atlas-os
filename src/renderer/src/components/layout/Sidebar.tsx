import { cn } from '@renderer/lib/utils'
import { type Section, useUiStore } from '@renderer/store/ui'
import {
  BarChart3,
  LayoutDashboard,
  type LucideIcon,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react'
import type { CSSProperties } from 'react'

const ITEMS: ReadonlyArray<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'stats', label: 'Stats', icon: BarChart3 },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

const dragRegion = { WebkitAppRegion: 'drag' } as CSSProperties
const noDragRegion = { WebkitAppRegion: 'no-drag' } as CSSProperties

export function Sidebar() {
  const section = useUiStore((s) => s.section)
  const setSection = useUiStore((s) => s.setSection)

  return (
    <aside
      className="flex h-full w-56 shrink-0 flex-col gap-1 border-r bg-sidebar p-3"
      style={dragRegion}
    >
      <div className="px-2 pt-8 pb-4">
        <span className="font-semibold text-sm tracking-tight">Atlas OS</span>
        <p className="text-muted-foreground text-xs">AI control panel</p>
      </div>
      <nav className="flex flex-col gap-1" style={noDragRegion}>
        {ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              section === id
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
