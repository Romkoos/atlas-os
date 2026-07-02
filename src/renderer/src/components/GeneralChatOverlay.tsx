import { trpc } from '@renderer/lib/trpc'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useEffect, useRef, useState } from 'react'

// Body of the general chat session, rendered inside UnifiedChatDrawer. Reads the
// App-level store, so the session survives tab switches / drawer collapse (the
// subscription lives in GeneralChatHost). Close/stop is owned by the drawer.
export function GeneralChatOverlay() {
  const status = useGeneralChatRun((s) => s.status)
  const requestId = useGeneralChatRun((s) => s.requestId)
  const transcript = useGeneralChatRun((s) => s.transcript)
  const streaming = useGeneralChatRun((s) => s.streaming)
  const awaitingInput = useGeneralChatRun((s) => s.awaitingInput)
  const startSession = useGeneralChatRun((s) => s.start)
  const pushUserReply = useGeneralChatRun((s) => s.pushUserReply)

  const reply = trpc.generalChat.reply.useMutation()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  const started = status !== 'idle'

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  const begin = () => {
    const text = draft.trim()
    if (!text) return
    startSession(text)
    setDraft('')
  }

  const send = () => {
    const text = draft.trim()
    if (!text || !requestId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ requestId, text })
    setDraft('')
  }

  return (
    <div className="rm-chat-body">
      {!started ? (
        <div className="rm-chat-intro">
          <span className="rm-field-label">New chat</span>
          <textarea
            className="input"
            rows={5}
            value={draft}
            placeholder="Ask anything…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                begin()
              }
            }}
            // biome-ignore lint/a11y/noAutofocus: focus the message field when a new chat opens
            autoFocus
          />
          <div className="rm-chat-hint">
            The assistant has read-only access to this repo. ⌘↵ to send.
          </div>
          <div className="rm-chat-intro-foot">
            <button type="button" className="btn primary" onClick={begin} disabled={!draft.trim()}>
              start chat
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
          </div>
          <div className="rm-chat-foot">
            <textarea
              className="input"
              rows={2}
              value={draft}
              placeholder={awaitingInput ? 'Reply…' : 'Assistant is thinking…'}
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
  )
}
