import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { ChatTranscript } from '@renderer/components/chat/ChatTranscript'
import { trpc } from '@renderer/lib/trpc'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import { useState } from 'react'

// Body of the general chat session, rendered inside UnifiedChatDrawer. Reads the
// App-level store, so the session survives tab switches / drawer collapse (the
// subscription lives in the App-level ChatHost). Close/stop is owned by the drawer.
export function GeneralChatOverlay() {
  const status = useGeneralChatRun((s) => s.status)
  const sessionId = useGeneralChatRun((s) => s.sessionId)
  const transcript = useGeneralChatRun((s) => s.transcript)
  const streaming = useGeneralChatRun((s) => s.streaming)
  const awaitingInput = useGeneralChatRun((s) => s.awaitingInput)
  const startSession = useGeneralChatRun((s) => s.start)
  const pushUserReply = useGeneralChatRun((s) => s.pushUserReply)

  const reply = trpc.generalChat.reply.useMutation()
  const [draft, setDraft] = useState('')

  const started = status !== 'idle'

  const send = (text: string) => {
    if (!sessionId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ sessionId, text })
  }

  if (!started) {
    return (
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
              if (draft.trim()) startSession(draft.trim())
            }
          }}
          // biome-ignore lint/a11y/noAutofocus: focus the message field when a new chat opens
          autoFocus
        />
        <div className="rm-chat-hint">
          The assistant has read-only access to this repo. ⌘↵ to start.
        </div>
        <div className="rm-chat-intro-foot">
          <button
            type="button"
            className="btn primary"
            onClick={() => draft.trim() && startSession(draft.trim())}
            disabled={!draft.trim()}
          >
            start chat
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-body-flex">
      <ChatTranscript
        transcript={transcript}
        streaming={streaming}
        awaitingInput={awaitingInput}
        onPickOption={send}
      />
      <ChatComposer
        disabled={!awaitingInput}
        placeholder={awaitingInput ? 'Reply…' : 'Assistant is thinking…'}
        onSend={send}
      />
    </div>
  )
}
