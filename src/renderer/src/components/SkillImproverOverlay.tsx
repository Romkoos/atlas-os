import { ChatComposer } from '@renderer/components/chat/ChatComposer'
import { ChatTranscript } from '@renderer/components/chat/ChatTranscript'
import { ImproverReportView } from '@renderer/components/ImproverReportView'
import { trpc } from '@renderer/lib/trpc'
import { useSkillImproverExtra, useSkillImproverRun } from '@renderer/store/skillImproverRun'

// Body of the skill-improver session, rendered inside UnifiedChatDrawer. Reads
// the App-level store, so the session survives tab switches / drawer collapse
// (the subscription lives in the App-level ChatHost). Cancel is owned by the
// drawer tab ×; Accept/Reject/Send are improver-specific and stay here.
export function SkillImproverOverlay() {
  const run = useSkillImproverRun()
  const report = useSkillImproverExtra((s) => s.report)
  const reply = trpc.skillImprover.reply.useMutation()
  const accept = trpc.skillImprover.accept.useMutation()
  const reject = trpc.skillImprover.reject.useMutation()

  const sessionId = run.sessionId

  const send = (text: string) => {
    if (!sessionId) return
    run.pushUserReply(text)
    reply.mutate({ sessionId, text })
  }

  return (
    <div className="skill-improver-body">
      <div className="chat-body-flex">
        <ChatTranscript
          transcript={run.transcript}
          streaming={run.streaming}
          awaitingInput={run.awaitingInput}
          onPickOption={send}
        />
        {report ? (
          <div className="improver-report-wrap">
            <ImproverReportView report={report} />
          </div>
        ) : null}

        {report ? (
          <div className="improver-foot">
            <button
              type="button"
              className="btn"
              disabled={accept.isPending || reject.isPending || !sessionId}
              onClick={() => sessionId && accept.mutate({ sessionId })}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn"
              disabled={accept.isPending || reject.isPending || !sessionId}
              onClick={() => sessionId && reject.mutate({ sessionId })}
            >
              Reject
            </button>
          </div>
        ) : run.running ? (
          <ChatComposer
            disabled={!run.awaitingInput}
            placeholder={run.awaitingInput ? 'Type your reply…' : 'thinking…'}
            onSend={send}
          />
        ) : null}
      </div>
    </div>
  )
}
