import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { ChatModelSelect } from '@renderer/components/chat/ChatModelSelect'
import { TimelineChatBody } from '@renderer/components/chat/TimelineChatBody'
import { trpc } from '@renderer/lib/trpc'
import { useGeneralChatRun } from '@renderer/store/generalChatRun'
import type { ClaudeModelId } from '@shared/models'
import { useState } from 'react'

// Body of the general chat session, rendered inside the CHATS page. Reads the
// App-level store, so the session survives tab switches (the subscription
// lives in the App-level ChatHost). Close/stop is owned by the CHATS page tab ×.
export function GeneralChatOverlay() {
  const status = useGeneralChatRun((s) => s.status)
  const sessionId = useGeneralChatRun((s) => s.sessionId)
  const transcript = useGeneralChatRun((s) => s.transcript)
  const streaming = useGeneralChatRun((s) => s.streaming)
  const awaitingInput = useGeneralChatRun((s) => s.awaitingInput)
  const startSession = useGeneralChatRun((s) => s.start)
  const pushUserReply = useGeneralChatRun((s) => s.pushUserReply)
  const timelineEvents = useGeneralChatRun((s) => s.timelineEvents)
  const running = useGeneralChatRun((s) => s.running)
  const freshStart = useGeneralChatRun((s) => s.freshStart)
  const subagents = useGeneralChatRun((s) => s.subagents)

  const reply = trpc.generalChat.reply.useMutation()
  const [draft, setDraft] = useState('')
  // null → the global default model (resolved in ChatModelSelect / on the server).
  const [model, setModel] = useState<ClaudeModelId | null>(null)

  const started = status !== 'idle'
  const startChat = () => draft.trim() && startSession(draft.trim(), model)

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
              startChat()
            }
          }}
          // biome-ignore lint/a11y/noAutofocus: focus the message field when a new chat opens
          autoFocus
        />
        <div className="rm-chat-hint">
          The assistant has read-only access to this repo. ⌘↵ to start.
        </div>
        <ChatModelSelect value={model} onChange={setModel} />
        <div className="rm-chat-intro-foot">
          <button
            type="button"
            className="btn primary"
            onClick={startChat}
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
      <TimelineChatBody
        sessionId={sessionId}
        transcript={transcript}
        streaming={streaming}
        timelineEvents={timelineEvents}
        running={running}
        freshStart={freshStart}
        subagents={subagents}
      />
      <ChatComposer
        disabled={!awaitingInput}
        placeholder={awaitingInput ? 'Reply…' : 'Assistant is thinking…'}
        onSend={send}
      />
    </div>
  )
}
