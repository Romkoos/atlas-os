import { BenchmarkChatOverlay } from '@renderer/components/BenchmarkChatOverlay'
import { GeneralChatOverlay } from '@renderer/components/GeneralChatOverlay'
import { RoadmapChatOverlay } from '@renderer/components/RoadmapChatOverlay'
import { SkillImproverOverlay } from '@renderer/components/SkillImproverOverlay'
import { WorkerChatOverlay } from '@renderer/components/WorkerChatOverlay'
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatContext, useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { type ChatSessionType, useChatDrawer } from '@renderer/store/chatDrawer'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useRoadmapChatRun, useRoadmapSaved } from '@renderer/store/roadmapChatRun'
import { useSkillImproverExtra, useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import { MessageSquare, Plus, Wrench, X } from 'lucide-react'
import { useEffect, useState } from 'react'

// The single UI surface for every chat session. Sessions themselves live in the
// domain stores and their subscriptions in the App-level hosts, so collapsing
// the drawer (or switching tabs) never stops a run. Only a tab's × ends a run.
export function UnifiedChatDrawer() {
  const open = useChatDrawer((s) => s.open)
  const sessions = useChatDrawer((s) => s.sessions)
  const activeSessionId = useChatDrawer((s) => s.activeSessionId)
  const setActive = useChatDrawer((s) => s.setActive)
  const setOpen = useChatDrawer((s) => s.setOpen)
  const openSession = useChatDrawer((s) => s.openSession)
  const closeSession = useChatDrawer((s) => s.closeSession)

  const benchCancel = trpc.benchmarkChat.cancel.useMutation()
  const roadmapCancel = trpc.roadmapChat.cancel.useMutation()
  const skillCancel = trpc.skillImprover.cancel.useMutation()
  const generalCancel = trpc.generalChat.cancel.useMutation()
  const workerCancel = trpc.workerChat.cancel.useMutation()

  const [pickerOpen, setPickerOpen] = useState(false)

  const endSession = (type: ChatSessionType) => {
    if (type === 'benchmark') {
      const st = useBenchmarkChatRun.getState()
      if (st.sessionId && st.running) benchCancel.mutate({ sessionId: st.sessionId })
      st.reset()
      useBenchmarkChatContext.getState().clearBatch()
    } else if (type === 'roadmap') {
      const st = useRoadmapChatRun.getState()
      if (st.sessionId && st.running) roadmapCancel.mutate({ sessionId: st.sessionId })
      st.reset()
      useRoadmapSaved.getState().clearSaved()
    } else if (type === 'skillImprover') {
      const st = useSkillImproverRun.getState()
      if (st.sessionId && st.running) skillCancel.mutate({ sessionId: st.sessionId })
      st.reset()
      useSkillImproverExtra.getState().clear()
    } else if (type === 'worker') {
      const st = useWorkerChatRun.getState()
      if (st.sessionId && st.running) workerCancel.mutate({ sessionId: st.sessionId })
      st.reset()
    } else {
      const st = useGeneralChatRun.getState()
      if (st.sessionId && st.running) generalCancel.mutate({ sessionId: st.sessionId })
      st.reset()
    }
    closeSession(type) // id === type
  }

  // The FAB (when empty) and the "+" button open a small two-icon picker; each
  // icon lands here. Start a fresh chat of `type` unless it is actively
  // streaming (running && !awaitingInput) — then just focus so we never
  // interrupt an in-flight response. Resetting also cancels the open server run.
  const openChat = (type: 'generalChat' | 'worker') => {
    const st = type === 'worker' ? useWorkerChatRun.getState() : useGeneralChatRun.getState()
    const cancel = type === 'worker' ? workerCancel : generalCancel
    const streamingNow = st.running && !st.awaitingInput
    if (st.status !== 'idle' && !streamingNow) {
      if (st.sessionId) cancel.mutate({ sessionId: st.sessionId })
      st.reset()
    }
    openSession({ type })
    setPickerOpen(false)
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

  // Two-icon choice (regular chat vs full-access worker), shared by the FAB
  // picker (drawer closed) and the header "+" dropdown (drawer open).
  const pickerButtons = (
    <>
      <button type="button" className="chat-picker-btn" onClick={() => openChat('generalChat')}>
        <MessageSquare size={16} />
        <span>Chat</span>
      </button>
      <button type="button" className="chat-picker-btn" onClick={() => openChat('worker')}>
        <Wrench size={16} />
        <span>Worker</span>
      </button>
    </>
  )

  return (
    <>
      {pickerOpen && !open ? (
        <div className="chat-picker" role="menu">
          {pickerButtons}
        </div>
      ) : null}

      <button
        type="button"
        className={`chat-fab${open ? ' chat-fab-hidden' : ''}`}
        aria-label="Open chat"
        onClick={() => (sessions.length === 0 ? setPickerOpen((o) => !o) : setOpen(true))}
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
          <div className="chat-new-wrap">
            <button
              type="button"
              className="chat-drawer-new"
              aria-label="New chat"
              onClick={() => setPickerOpen((o) => !o)}
            >
              <Plus size={14} />
            </button>
            {pickerOpen && open ? (
              <div className="chat-picker chat-picker-inline" role="menu">
                {pickerButtons}
              </div>
            ) : null}
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
          {active?.type === 'generalChat' ? <GeneralChatOverlay /> : null}
          {active?.type === 'worker' ? <WorkerChatOverlay /> : null}
        </div>
      </aside>
    </>
  )
}
