import { BenchmarkChatOverlay } from '@renderer/components/BenchmarkChatOverlay'
import { Canvas } from '@renderer/components/chat/Canvas'
import { SplitPane } from '@renderer/components/chat/SplitPane'
import { GeneralChatOverlay } from '@renderer/components/GeneralChatOverlay'
import { RoadmapChatOverlay } from '@renderer/components/RoadmapChatOverlay'
import { SkillImproverOverlay } from '@renderer/components/SkillImproverOverlay'
import { WorkerChatOverlay } from '@renderer/components/WorkerChatOverlay'
import { springSnappy } from '@renderer/lib/motion'
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatContext, useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { type ChatSessionType, useChats } from '@renderer/store/chats'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useRoadmapChatRun, useRoadmapSaved } from '@renderer/store/roadmapChatRun'
import { useSkillImproverExtra, useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import { MessageSquare, Plus, Wrench, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'

// The CHATS page: one screen, tab strip on top, split left (conversation) /
// right (Canvas) below. Sessions live in the per-type run stores and their
// subscriptions in the App-level ChatHosts, so switching tabs (or leaving the
// page) never stops a run. Only a tab's × ends a run. This page is the single
// mount point for the five chat overlays — the old slide-out drawer component
// was deleted in this same commit so the overlay bodies are never double-mounted.
export function Chats() {
  const sessions = useChats((s) => s.sessions)
  const activeSessionId = useChats((s) => s.activeSessionId)
  const setActive = useChats((s) => s.setActive)
  const openSession = useChats((s) => s.openSession)
  const closeSession = useChats((s) => s.closeSession)
  const splitRatio = useChats((s) => s.splitRatio)
  const setSplitRatio = useChats((s) => s.setSplitRatio)

  const benchCancel = trpc.benchmarkChat.cancel.useMutation()
  const roadmapCancel = trpc.roadmapChat.cancel.useMutation()
  const skillCancel = trpc.skillImprover.cancel.useMutation()
  const generalCancel = trpc.generalChat.cancel.useMutation()
  const workerCancel = trpc.workerChat.cancel.useMutation()
  const [pickerOpen, setPickerOpen] = useState(false)

  // endSession(type): cancel the running server run (if any), reset the run
  // store, clear the companion store, then closeSession.
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

  // openChat(type): start a fresh chat of `type` unless it is actively
  // streaming (running && !awaitingInput) — then just focus so we never
  // interrupt an in-flight response. Resetting also cancels the open server
  // run.
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

  // The five chat overlay bodies. Mounted exactly once, here — never in a
  // second host — so cutting the drawer over to this page can't double-mount.
  const overlay = (
    <>
      {active?.type === 'benchmark' ? <BenchmarkChatOverlay /> : null}
      {active?.type === 'roadmap' ? <RoadmapChatOverlay /> : null}
      {active?.type === 'skillImprover' ? <SkillImproverOverlay /> : null}
      {active?.type === 'generalChat' ? <GeneralChatOverlay /> : null}
      {active?.type === 'worker' ? <WorkerChatOverlay /> : null}
    </>
  )

  return (
    <div className="chats-page">
      <div className="chats-tabs">
        <div className="chats-tablist">
          {sessions.map((s) => (
            <div key={s.id} className={`chat-tab${s.id === activeSessionId ? ' active' : ''}`}>
              {s.id === activeSessionId && (
                <motion.span layoutId="chats-tab" className="tab-ink" transition={springSnappy} />
              )}
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
        {/* The "+" picker lives OUTSIDE .chats-tablist: that list is an
            overflow-x:auto scroller (which computes overflow-y to auto), so a
            dropdown anchored inside it would be clipped. Keeping the wrap as a
            sibling lets the menu escape. */}
        <div className="chat-new-wrap">
          <button
            type="button"
            className="chats-new-btn"
            aria-label="New chat"
            onClick={() => setPickerOpen((o) => !o)}
          >
            <Plus size={14} />
          </button>
          {pickerOpen ? (
            <div className="chat-picker chat-picker-inline" role="menu">
              {pickerButtons}
            </div>
          ) : null}
        </div>
      </div>

      {active ? (
        <SplitPane
          ratio={splitRatio}
          onRatioChange={setSplitRatio}
          left={<div className="chat-left">{overlay}</div>}
          right={<Canvas type={active.type} />}
        />
      ) : (
        <div className="chats-empty">No chats open. Use + to start one.</div>
      )}
    </div>
  )
}
