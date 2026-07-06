import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { ChatModelSelect } from '@renderer/components/chat/ChatModelSelect'
import { ChatTranscript } from '@renderer/components/chat/ChatTranscript'
import { trpc } from '@renderer/lib/trpc'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import { useWorkerPrefill } from '@renderer/store/workerPrefill'
import type { ClaudeModelId } from '@shared/models'
import { useEffect, useState } from 'react'

// Body of the worker chat session — a full-access coding agent. Same shape as
// GeneralChatOverlay but with write access framed in the intro.
export function WorkerChatOverlay() {
  const status = useWorkerChatRun((s) => s.status)
  const sessionId = useWorkerChatRun((s) => s.sessionId)
  const transcript = useWorkerChatRun((s) => s.transcript)
  const streaming = useWorkerChatRun((s) => s.streaming)
  const awaitingInput = useWorkerChatRun((s) => s.awaitingInput)
  const startSession = useWorkerChatRun((s) => s.start)
  const pushUserReply = useWorkerChatRun((s) => s.pushUserReply)

  const reply = trpc.workerChat.reply.useMutation()
  const [draft, setDraft] = useState('')
  // null → the global default model (resolved in ChatModelSelect / on the server).
  const [model, setModel] = useState<ClaudeModelId | null>(null)

  // One-shot hand-off from callers like the Roadmap "start development" button:
  // seed the intro composer with the idea's prompt + preselected model, then
  // consume it. Runs only while the intro is shown (status === 'idle').
  const pending = useWorkerPrefill((s) => s.pending)
  const clearPrefill = useWorkerPrefill((s) => s.clearPrefill)
  useEffect(() => {
    if (!pending || status !== 'idle') return
    setDraft(pending.prompt)
    setModel(pending.model)
    clearPrefill()
  }, [pending, status, clearPrefill])

  const started = status !== 'idle'
  const startWorker = () => draft.trim() && startSession(draft.trim(), model)

  const send = (text: string) => {
    if (!sessionId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ sessionId, text })
  }

  if (!started) {
    return (
      <div className="rm-chat-intro">
        <span className="rm-field-label">New worker</span>
        <textarea
          className="input"
          rows={5}
          value={draft}
          placeholder="Describe the change to make…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              startWorker()
            }
          }}
          // biome-ignore lint/a11y/noAutofocus: focus the message field when a new worker opens
          autoFocus
        />
        <div className="rm-chat-hint">The worker can read and modify this repo. ⌘↵ to start.</div>
        <ChatModelSelect value={model} onChange={setModel} />
        <div className="rm-chat-intro-foot">
          <button
            type="button"
            className="btn primary"
            onClick={startWorker}
            disabled={!draft.trim()}
          >
            start worker
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
        placeholder={awaitingInput ? 'Reply…' : 'Worker is working…'}
        onSend={send}
      />
    </div>
  )
}
