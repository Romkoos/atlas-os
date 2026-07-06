import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { TimelineChatBody } from '@renderer/components/chat/TimelineChatBody'
import { trpc } from '@renderer/lib/trpc'
import { useRoadmapChatRun, useRoadmapSaved } from '@renderer/store/roadmapChatRun'
import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'

// Body of the roadmap brainstorming session, rendered inside UnifiedChatDrawer.
// Reads the App-level store, so the session survives tab switches / drawer
// collapse (the subscription lives in the App-level ChatHost). Close/stop is
// owned by the drawer.
export function RoadmapChatOverlay() {
  const status = useRoadmapChatRun((s) => s.status)
  const sessionId = useRoadmapChatRun((s) => s.sessionId)
  const transcript = useRoadmapChatRun((s) => s.transcript)
  const streaming = useRoadmapChatRun((s) => s.streaming)
  const awaitingInput = useRoadmapChatRun((s) => s.awaitingInput)
  const savedItem = useRoadmapSaved((s) => s.savedItem)
  const startSession = useRoadmapChatRun((s) => s.start)
  const pushUserReply = useRoadmapChatRun((s) => s.pushUserReply)
  const timelineEvents = useRoadmapChatRun((s) => s.timelineEvents)
  const running = useRoadmapChatRun((s) => s.running)
  const freshStart = useRoadmapChatRun((s) => s.freshStart)

  const reply = trpc.roadmapChat.reply.useMutation()
  const [draft, setDraft] = useState('')

  const started = status !== 'idle'

  const beginBrainstorm = () => {
    const idea = draft.trim()
    if (!idea) return
    useRoadmapSaved.getState().clearSaved()
    startSession(idea)
    setDraft('')
  }

  const send = (text: string) => {
    if (!sessionId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ sessionId, text })
  }

  if (!started) {
    return (
      <div className="rm-chat-intro">
        <span className="rm-field-label">Describe your idea</span>
        <textarea
          className="input"
          rows={5}
          value={draft}
          placeholder="e.g. a panel that shows which skills I use most and suggests ones to retire…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              beginBrainstorm()
            }
          }}
          // biome-ignore lint/a11y/noAutofocus: focus the idea field when the incubator opens
          autoFocus
        />
        <div className="rm-chat-hint">
          The agent will brainstorm it with you (in your language) and save a finished, English card
          to the right category. ⌘↵ to start.
        </div>
        <div className="rm-chat-intro-foot">
          <button
            type="button"
            className="btn primary"
            onClick={beginBrainstorm}
            disabled={!draft.trim()}
          >
            start brainstorming
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-body-flex">
      <TimelineChatBody
        sessionId={sessionId}
        transcript={transcript}
        streaming={streaming}
        awaitingInput={awaitingInput}
        timelineEvents={timelineEvents}
        running={running}
        freshStart={freshStart}
        onPickOption={send}
      />
      {savedItem ? (
        <div className="rm-chat-saved">
          <CheckCircle2 size={14} />
          saved to {savedItem.category}: {savedItem.title}
        </div>
      ) : null}
      <ChatComposer
        disabled={!awaitingInput}
        placeholder={awaitingInput ? 'Reply…' : 'Agent is thinking…'}
        onSend={send}
      />
    </div>
  )
}
