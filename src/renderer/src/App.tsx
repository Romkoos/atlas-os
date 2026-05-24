import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { NAV } from '@renderer/components/layout/nav'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { TitleBar } from '@renderer/components/layout/TitleBar'
import { Toaster } from '@renderer/components/ui/sonner'
import { Dashboard } from '@renderer/pages/Dashboard'
import { Productivity } from '@renderer/pages/Productivity'
import { Settings } from '@renderer/pages/Settings'
import { Skills } from '@renderer/pages/Skills'
import { Stats } from '@renderer/pages/Stats'
import { useResolvedTheme } from '@renderer/providers/ThemeProvider'
import { type Section, useUiStore } from '@renderer/store/ui'
import { type ComponentType, useEffect } from 'react'

const PAGES: Record<Section, ComponentType> = {
  dashboard: Dashboard,
  stats: Stats,
  productivity: Productivity,
  skills: Skills,
  settings: Settings,
}

export function App() {
  const section = useUiStore((s) => s.section)
  const setSection = useUiStore((s) => s.setSection)
  const theme = useResolvedTheme()

  // Native menu (Cmd+,) asks the renderer to switch sections.
  useEffect(() => window.atlas.onNavigate((next) => setSection(next as Section)), [setSection])

  // Cmd/Ctrl+1..5 jump straight to a screen (matches the [NN] sidebar keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const n = Number.parseInt(e.key, 10)
      if (n >= 1 && n <= NAV.length) {
        e.preventDefault()
        setSection(NAV[n - 1].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setSection])

  const Page = PAGES[section]

  return (
    <ErrorBoundary>
      <div className="win">
        <TitleBar section={section} />
        <div className="app">
          <Sidebar />
          <main className="main">
            <Page />
          </main>
        </div>
      </div>
      <Toaster theme={theme} richColors closeButton />
    </ErrorBoundary>
  )
}
