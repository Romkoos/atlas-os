// src/renderer/src/components/BenchmarkChatOverlay.tsx
import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { TimelineChatBody } from '@renderer/components/chat/TimelineChatBody'
import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatRun } from '@renderer/store/benchmarkChatRun'

// Body of the benchmark-discussion session, rendered inside UnifiedChatDrawer.
// Reads the App-level store, so the session continues even when this body is
// unmounted (tab switch / drawer collapse). Close/stop is owned by the drawer.
export function BenchmarkChatOverlay() {
  const status = useBenchmarkChatRun((s) => s.status)
  const sessionId = useBenchmarkChatRun((s) => s.sessionId)
  const transcript = useBenchmarkChatRun((s) => s.transcript)
  const streaming = useBenchmarkChatRun((s) => s.streaming)
  const awaitingInput = useBenchmarkChatRun((s) => s.awaitingInput)
  const pushUserReply = useBenchmarkChatRun((s) => s.pushUserReply)
  const timelineEvents = useBenchmarkChatRun((s) => s.timelineEvents)
  const running = useBenchmarkChatRun((s) => s.running)
  const freshStart = useBenchmarkChatRun((s) => s.freshStart)
  const subagents = useBenchmarkChatRun((s) => s.subagents)

  const reply = trpc.benchmarkChat.reply.useMutation()

  if (status === 'idle') return null

  const send = (text: string) => {
    if (!sessionId || !awaitingInput) return
    pushUserReply(text)
    reply.mutate({ sessionId, text })
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
        subagents={subagents}
      />
      <ChatComposer
        disabled={!awaitingInput}
        placeholder={awaitingInput ? 'Ask about the results…' : 'Model is working…'}
        onSend={send}
      />
    </div>
  )
}
