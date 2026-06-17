// src/renderer/src/components/BenchmarkChatOverlay.tsx
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { useEffect, useRef, useState } from 'react'

// Floating discussion panel over the benchmark tab. Reads the App-level store,
// so the session continues even when this overlay is unmounted (tab switch).
export function BenchmarkChatOverlay() {
  const status = useBenchmarkChatRun((s) => s.status)
  const requestId = useBenchmarkChatRun((s) => s.requestId)
  const transcript = useBenchmarkChatRun((s) => s.transcript)
  const streaming = useBenchmarkChatRun((s) => s.streaming)
  const awaitingInput = useBenchmarkChatRun((s) => s.awaitingInput)
  const pushUserReply = useBenchmarkChatRun((s) => s.pushUserReply)
  const reset = useBenchmarkChatRun((s) => s.reset)

  const reply = trpc.benchmarkChat.reply.useMutation()
  const cancel = trpc.benchmarkChat.cancel.useMutation()
  const [draft, setDraft] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  if (status === 'idle') return null

  const send = () => {
    const text = draft.trim()
    if (!text || !requestId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ requestId, text })
    setDraft('')
  }

  const closeChat = () => {
    if (requestId && status === 'running') cancel.mutate({ requestId })
    reset()
  }

  return (
    <div className="bench-chat">
      <div className="bench-chat-head">
        <span className="ttl">discuss results</span>
        <button type="button" className="btn" onClick={closeChat}>
          {status === 'running' ? 'STOP' : 'CLOSE'}
        </button>
      </div>
      <div className="bench-chat-log" ref={logRef}>
        {transcript.map((e, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only; no stable id
          <div key={i} className={`bench-chat-entry ${e.kind}`}>
            {e.kind === 'tool' ? `· ${e.text}` : e.text}
          </div>
        ))}
        {streaming ? <div className="bench-chat-entry assistant">{streaming}</div> : null}
      </div>
      <div className="bench-chat-foot">
        <textarea
          className="input"
          rows={2}
          value={draft}
          placeholder={awaitingInput ? 'Ask about the results…' : 'Model is working…'}
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
          SEND
        </button>
      </div>
    </div>
  )
}
