import { ImproverReportView } from '@renderer/components/ImproverReportView'
import { trpc } from '@renderer/lib/trpc'
import { useSkillImproverExtra, useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { useEffect, useRef, useState } from 'react'

// Body of the skill-improver session, rendered inside UnifiedChatDrawer. Reads
// the App-level store, so the session survives tab switches / drawer collapse
// (the subscription lives in SkillImproverHost). Cancel is owned by the drawer
// tab ×; Accept/Reject/Send are improver-specific and stay here.
export function SkillImproverOverlay() {
  const run = useSkillImproverRun()
  const report = useSkillImproverExtra((s) => s.report)
  const reply = trpc.skillImprover.reply.useMutation()
  const accept = trpc.skillImprover.accept.useMutation()
  const reject = trpc.skillImprover.reject.useMutation()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin whenever streamed content changes
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run.transcript, run.streaming, report])

  const sessionId = run.sessionId

  function send() {
    const text = draft.trim()
    if (!text || !sessionId) return
    run.pushUserReply(text)
    reply.mutate({ sessionId, text })
    setDraft('')
  }

  return (
    <div className="skill-improver-body">
      <div className="improver">
        <div className="improver-transcript" ref={scrollRef}>
          {run.transcript.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only
            <div key={i} className={`improver-entry ${e.kind}`}>
              {e.kind === 'tool' ? `⚙ ${e.text}` : e.text}
            </div>
          ))}
          {run.streaming ? <div className="improver-entry">{run.streaming}</div> : null}
          {report ? (
            <div style={{ marginTop: 16 }}>
              <ImproverReportView report={report} />
            </div>
          ) : null}
        </div>

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
          <div className="improver-foot">
            <input
              className="input"
              placeholder={run.awaitingInput ? 'Type your reply…' : 'thinking…'}
              disabled={!run.awaitingInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button type="button" className="btn" disabled={!run.awaitingInput} onClick={send}>
              Send
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
