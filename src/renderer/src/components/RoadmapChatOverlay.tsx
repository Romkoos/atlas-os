import { trpc } from '@renderer/lib/trpc'
import { useRoadmapChatRun } from '@renderer/store/roadmapChatRun'
import { CheckCircle2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Floating brainstorming panel opened by "new idea". Reads the App-level store,
// so the session survives tab switches (the subscription lives in
// RoadmapChatHost). `onClose` hides the overlay and tears the session down.
export function RoadmapChatOverlay({ onClose }: { onClose: () => void }) {
  const status = useRoadmapChatRun((s) => s.status)
  const requestId = useRoadmapChatRun((s) => s.requestId)
  const transcript = useRoadmapChatRun((s) => s.transcript)
  const streaming = useRoadmapChatRun((s) => s.streaming)
  const awaitingInput = useRoadmapChatRun((s) => s.awaitingInput)
  const savedItem = useRoadmapChatRun((s) => s.savedItem)
  const running = useRoadmapChatRun((s) => s.running)
  const startSession = useRoadmapChatRun((s) => s.start)
  const pushUserReply = useRoadmapChatRun((s) => s.pushUserReply)
  const reset = useRoadmapChatRun((s) => s.reset)

  const reply = trpc.roadmapChat.reply.useMutation()
  const cancel = trpc.roadmapChat.cancel.useMutation()
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
    startSession(idea)
    setDraft('')
  }

  const send = () => {
    const text = draft.trim()
    if (!text || !requestId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ requestId, text })
    setDraft('')
  }

  const close = () => {
    if (requestId && running) cancel.mutate({ requestId })
    reset()
    onClose()
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only Esc listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="rm-backdrop">
      <button type="button" className="rm-backdrop-btn" aria-label="Close chat" onClick={close} />
      <div
        className="panel rm-modal rm-chat"
        role="dialog"
        aria-modal="true"
        aria-label="Idea incubator"
      >
        <div className="rm-modal-head">
          <span className="tag">idea incubator</span>
          <button type="button" className="btn" onClick={close}>
            {running ? 'stop' : 'close'}
          </button>
        </div>

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
            <div className="rm-modal-foot" style={{ borderTop: 0, padding: 0 }}>
              <button type="button" className="btn" onClick={close}>
                cancel
              </button>
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
                disabled={!awaitingInput || status !== 'running'}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send()
                  }
                }}
              />
              <button
                type="button"
                className="btn primary"
                disabled={!awaitingInput || status !== 'running'}
                onClick={send}
              >
                send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
