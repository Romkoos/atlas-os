import { ChatHost } from '@renderer/components/ChatHost'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { BootSequence } from '@renderer/components/fx/BootSequence'
import { SpaceScene } from '@renderer/components/fx/SpaceScene'
import { NAV } from '@renderer/components/layout/nav'
import { Sidebar } from '@renderer/components/layout/Sidebar'
import { TitleBar } from '@renderer/components/layout/TitleBar'
import { NewsRunHost } from '@renderer/components/NewsRunHost'
import { TrendingRunHost } from '@renderer/components/TrendingRunHost'
import { UnifiedChatDrawer } from '@renderer/components/UnifiedChatDrawer'
import { Toaster } from '@renderer/components/ui/sonner'
import { trpc } from '@renderer/lib/trpc'
import { Dashboard } from '@renderer/pages/Dashboard'
import { Info } from '@renderer/pages/Info'
import { Knowledge } from '@renderer/pages/Knowledge'
import { News } from '@renderer/pages/News'
import { Plugins } from '@renderer/pages/Plugins'
import { Productivity } from '@renderer/pages/Productivity'
import { Roadmap } from '@renderer/pages/Roadmap'
import { Settings } from '@renderer/pages/Settings'
import { Skills } from '@renderer/pages/Skills'
import { Stats } from '@renderer/pages/Stats'
import { useResolvedTheme } from '@renderer/providers/ThemeProvider'
import { useBenchmarkChatContext, useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useRoadmapChatRun, useRoadmapSaved } from '@renderer/store/roadmapChatRun'
import { useSkillImproverExtra, useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { type Section, useUiStore } from '@renderer/store/ui'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import type { RoadmapItem } from '@shared/roadmap'
import type { ImproverReport } from '@shared/skillImprover'
import { MotionConfig } from 'motion/react'
import { type ComponentType, useEffect } from 'react'

const PAGES: Record<Section, ComponentType> = {
  dashboard: Dashboard,
  roadmap: Roadmap,
  stats: Stats,
  productivity: Productivity,
  knowledge: Knowledge,
  news: News,
  info: Info,
  skills: Skills,
  plugins: Plugins,
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

  // Kickoffs: general/roadmap use the first user message; benchmark/improver use
  // a domain id (batchId/skillId) carried in a companion store.
  const generalKickoff = useGeneralChatRun((s) => s.transcript[0]?.text)
  const workerKickoff = useWorkerChatRun((s) => s.transcript[0]?.text)
  const roadmapKickoff = useRoadmapChatRun((s) => s.transcript[0]?.text)
  const benchmarkKickoff = useBenchmarkChatContext((s) => s.batchId) ?? undefined
  const improverKickoff = useSkillImproverExtra((s) => s.skillId) ?? undefined

  return (
    <ErrorBoundary>
      <MotionConfig reducedMotion="user">
        <SpaceScene />
        <div className="win">
          <TitleBar section={section} />
          <div className="app">
            <Sidebar />
            <main className="main">
              {/* Glitch-burst on section switch (CSS, enter-only): remounting
                  the keyed div restarts the animation; navigation never blocks. */}
              <div key={section} className="page-anim">
                <Page />
              </div>
            </main>
          </div>
        </div>
        <NewsRunHost />
        <TrendingRunHost />
        <ChatHost
          useRun={useGeneralChatRun}
          useOpenSubscription={trpc.generalChat.open.useSubscription}
          kickoff={generalKickoff}
        />
        <ChatHost
          useRun={useWorkerChatRun}
          useOpenSubscription={trpc.workerChat.open.useSubscription}
          kickoff={workerKickoff}
        />
        <ChatHost
          useRun={useRoadmapChatRun}
          useOpenSubscription={trpc.roadmapChat.open.useSubscription}
          kickoff={roadmapKickoff}
          onEvent={(event) => {
            const e = event as { type: string; item?: RoadmapItem }
            if (e.type === 'saved' && e.item) useRoadmapSaved.getState().setSaved(e.item)
          }}
        />
        <ChatHost
          useRun={useBenchmarkChatRun}
          useOpenSubscription={trpc.benchmarkChat.open.useSubscription}
          kickoff={benchmarkKickoff}
        />
        <ChatHost
          useRun={useSkillImproverRun}
          useOpenSubscription={trpc.skillImprover.open.useSubscription}
          kickoff={improverKickoff}
          onEvent={(event) => {
            const e = event as { type: string; report?: ImproverReport }
            if (e.type === 'report' && e.report)
              useSkillImproverExtra.getState().setReport(e.report)
          }}
        />
        <UnifiedChatDrawer />
        <Toaster theme={theme} richColors closeButton />
        <BootSequence />
      </MotionConfig>
    </ErrorBoundary>
  )
}
