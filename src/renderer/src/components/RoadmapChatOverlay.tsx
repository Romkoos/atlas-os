import { trpc } from '@renderer/lib/trpc'
import { useRoadmapChatRun, useRoadmapSaved } from '@renderer/store/roadmapChatRun'
import { CheckCircle2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Body of the roadmap brainstorming session, rendered inside UnifiedChatDrawer.
// Reads the App-level store, so the session survives tab switches / drawer
// collapse (the subscription lives in RoadmapChatHost). Close/stop is owned by
// the drawer.
export function RoadmapChatOverlay() {
  const status = useRoadmapChatRun((s) => s.status)
  const sessionId = useRoadmapChatRun((s) => s.sessionId)
  const transcript = useRoadmapChatRun((s) => s.transcript)
  const streaming = useRoadmapChatRun((s) => s.streaming)
  const awaitingInput = useRoadmapChatRun((s) => s.awaitingInput)
  const savedItem = useRoadmapSaved((s) => s.savedItem)
  const startSession = useRoadmapChatRun((s) => s.start)
  const pushUserReply = useRoadmapChatRun((s) => s.pushUserReply)

  const reply = trpc.roadmapChat.reply.useMutation()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const started = status !== 'idle'

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming, savedItem])

  const beginBrainstorm = () => {
    const idea = draft.trim()
    if (!idea) return
    useRoadmapSaved.getState().clearSaved()
    startSession(idea)
    setDraft('')
  }

  const send = () => {
    const text = draft.trim()
    if (!text || !sessionId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ sessionId, text })
    setDraft('')
  }

  return (
    <div className="rm-chat-body">
      {!started ? (
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
            The agent will brainstorm it with you (in your language) and save a finished, English
            card to the right category. ⌘↵ to start.
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
      ) : (
        <>
          <div className="rm-chat-log" ref={logRef}>
            {transcript.map((e, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only; no stable id
              <div key={i} className={`rm-chat-entry ${e.kind}`}>
                {e.kind === 'tool' ? `· ${e.text}` : e.text}
              </div>
            ))}
            {streaming ? <div className="rm-chat-entry assistant">{streaming}</div> : null}
            {savedItem ? (
              <div className="rm-chat-saved">
                <CheckCircle2 size={14} />
                saved to {savedItem.category}: {savedItem.title}
              </div>
            ) : null}
          </div>
          <div className="rm-chat-foot">
            <textarea
              className="input"
              rows={2}
              value={draft}
              placeholder={awaitingInput ? 'Reply…' : 'Agent is thinking…'}
              disabled={!awaitingInput}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button type="button" className="btn primary" disabled={!awaitingInput} onClick={send}>
              send
            </button>
          </div>
        </>
      )}
    </div>
  )
}
