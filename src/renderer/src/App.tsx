import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { Toaster } from '@renderer/components/ui/sonner'
import { Dashboard } from '@renderer/pages/Dashboard'
import { Settings } from '@renderer/pages/Settings'
import { Stats } from '@renderer/pages/Stats'
import { useResolvedTheme } from '@renderer/providers/ThemeProvider'
import { type Section, useUiStore } from '@renderer/store/ui'
import { type ComponentType, useEffect } from 'react'

const PAGES: Record<Section, ComponentType> = {
  dashboard: Dashboard,
  stats: Stats,
  settings: Settings,
}

export function App() {
  const section = useUiStore((s) => s.section)
  const setSection = useUiStore((s) => s.setSection)
  const theme = useResolvedTheme()

  // Native menu (Cmd+,) asks the renderer to switch sections.
  useEffect(() => window.atlas.onNavigate((next) => setSection(next as Section)), [setSection])

  const Page = PAGES[section]

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
        <Sidebar />
        <main className="flex-1 overflow-y-auto">
          <Page />
        </main>
      </div>
      <Toaster theme={theme} richColors closeButton />
    </ErrorBoundary>
  )
}
