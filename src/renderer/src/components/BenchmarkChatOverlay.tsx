// src/renderer/src/components/BenchmarkChatOverlay.tsx
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'
import { useEffect, useRef, useState } from 'react'

// Body of the benchmark-discussion session, rendered inside UnifiedChatDrawer.
// Reads the App-level store, so the session continues even when this body is
// unmounted (tab switch / drawer collapse). Close/stop is owned by the drawer.
export function BenchmarkChatOverlay() {
  const status = useBenchmarkChatRun((s) => s.status)
  const requestId = useBenchmarkChatRun((s) => s.requestId)
  const transcript = useBenchmarkChatRun((s) => s.transcript)
  const streaming = useBenchmarkChatRun((s) => s.streaming)
  const awaitingInput = useBenchmarkChatRun((s) => s.awaitingInput)
  const pushUserReply = useBenchmarkChatRun((s) => s.pushUserReply)

  const reply = trpc.benchmarkChat.reply.useMutation()
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

  return (
    <div className="bench-chat-body">
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
