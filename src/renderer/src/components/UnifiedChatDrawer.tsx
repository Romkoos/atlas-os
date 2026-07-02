import { BenchmarkChatOverlay } from '@renderer/components/BenchmarkChatOverlay'
import { RoadmapChatOverlay } from '@renderer/components/RoadmapChatOverlay'
import { SkillImproverOverlay } from '@renderer/components/SkillImproverOverlay'
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { type ChatSessionType, useChatDrawer } from '@renderer/store/chatDrawer'
import { useRoadmapChatRun } from '@renderer/store/roadmapChatRun'
import { useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { MessageSquare, X } from 'lucide-react'
import { useEffect } from 'react'

// The single UI surface for every chat session. Sessions themselves live in the
// domain stores and their subscriptions in the App-level hosts, so collapsing
// the drawer (or switching tabs) never stops a run. Only a tab's × ends a run.
export function UnifiedChatDrawer() {
  const open = useChatDrawer((s) => s.open)
  const sessions = useChatDrawer((s) => s.sessions)
  const activeSessionId = useChatDrawer((s) => s.activeSessionId)
  const setActive = useChatDrawer((s) => s.setActive)
  const setOpen = useChatDrawer((s) => s.setOpen)
  const toggle = useChatDrawer((s) => s.toggle)
  const closeSession = useChatDrawer((s) => s.closeSession)

  const benchCancel = trpc.benchmarkChat.cancel.useMutation()
  const roadmapCancel = trpc.roadmapChat.cancel.useMutation()
  const skillCancel = trpc.skillImprover.cancel.useMutation()

  const endSession = (type: ChatSessionType) => {
    if (type === 'benchmark') {
      const st = useBenchmarkChatRun.getState()
      if (st.requestId && st.running) benchCancel.mutate({ requestId: st.requestId })
      st.reset()
    } else if (type === 'roadmap') {
      const st = useRoadmapChatRun.getState()
      if (st.requestId && st.running) roadmapCancel.mutate({ requestId: st.requestId })
      st.reset()
    } else {
      const st = useSkillImproverRun.getState()
      if (st.requestId && st.running) skillCancel.mutate({ requestId: st.requestId })
      st.reset()
    }
    closeSession(type) // id === type
  }

  const active = sessions.find((s) => s.id === activeSessionId)
  const wide = active?.type === 'skillImprover'

  // Escape collapses the drawer (sessions keep running in the background).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  return (
    <>
      <button
        type="button"
        className={`chat-fab${open ? ' chat-fab-hidden' : ''}`}
        aria-label="Open chat"
        onClick={toggle}
      >
        <MessageSquare size={18} />
        {sessions.length > 0 ? <span className="chat-fab-badge">{sessions.length}</span> : null}
      </button>

      <aside
        className={`chat-drawer${open ? ' open' : ''}${wide ? ' wide' : ''}`}
        aria-hidden={!open}
      >
        <div className="chat-drawer-tabs">
          <div className="chat-drawer-tablist">
            {sessions.map((s) => (
              <div key={s.id} className={`chat-tab${s.id === activeSessionId ? ' active' : ''}`}>
                <button type="button" className="chat-tab-btn" onClick={() => setActive(s.id)}>
                  {s.title}
                </button>
                <button
                  type="button"
                  className="chat-tab-x"
                  aria-label={`Close ${s.title}`}
                  onClick={() => endSession(s.type)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="chat-drawer-collapse"
            aria-label="Collapse chat"
            onClick={() => setOpen(false)}
          >
            <X size={14} />
          </button>
        </div>
        <div className="chat-drawer-body">
          {active?.type === 'benchmark' ? <BenchmarkChatOverlay /> : null}
          {active?.type === 'roadmap' ? <RoadmapChatOverlay /> : null}
          {active?.type === 'skillImprover' ? <SkillImproverOverlay /> : null}
        </div>
      </aside>
    </>
  )
}
