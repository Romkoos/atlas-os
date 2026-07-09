import type { ChatEntry, SubagentRun } from '@renderer/store/createChatRunStore'
import { Bot, ChevronRight, Loader2, X, Zap } from 'lucide-react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseOptions } from './parseOptions'
import { ToolActivityGroup } from './ToolActivityGroup'

type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>

// Skill invocations stay visible (the user asked to keep them), showing the
// skill name; everything else collapses into the activity group.
function SkillCall({ entry }: { entry: ToolEntry }) {
  const name = entry.text.replace(/^Skill:\s*/i, '') || 'skill'
  return (
    <div className={`chat-skill ${entry.status}`}>
      {entry.status === 'running' ? <Loader2 size={13} className="chat-spin" /> : <Zap size={13} />}
      <span className="chat-skill-name">{name}</span>
    </div>
  )
}

// A Task (subagent) call: a collapsed header over a NESTED <ChatTranscript> of
// the subagent's own live steps, keyed by the Task's tool_use id in `subagents`.
// Auto-expanded while the Task runs, auto-collapsed once it resolves; a manual
// toggle latches (`userToggled`) and thereafter wins over the auto behavior.
function TaskActivity({
  entry,
  subagents,
}: {
  entry: ToolEntry
  subagents: Record<string, SubagentRun>
}) {
  const sub = subagents[entry.id]
  const running = entry.status === 'running'
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const open = userToggled !== null ? userToggled : running
  const steps = sub ? sub.transcript.filter((e) => e.kind === 'tool').length : 0

  return (
    <div className={`chat-activity chat-subagent${entry.status === 'error' ? ' has-error' : ''}`}>
      <button type="button" className="chat-activity-head" onClick={() => setUserToggled(!open)}>
        {running ? (
          <Loader2 size={13} className="chat-spin" />
        ) : entry.status === 'error' ? (
          <X size={13} />
        ) : (
          <Bot size={13} />
        )}
        <span className="chat-activity-label">{entry.text}</span>
        {steps > 0 ? (
          <span className="chat-subagent-count">
            {steps} step{steps === 1 ? '' : 's'}
          </span>
        ) : null}
        {running ? <Loader2 size={12} className="chat-spin chat-subagent-mini" /> : null}
        <ChevronRight size={13} className={`chat-chev${open ? ' open' : ''}`} />
      </button>
      <div className={`chat-collapse${open ? ' open' : ''}`}>
        <div className="chat-collapse-inner">
          <div className="chat-subagent-body">
            {sub && (sub.transcript.length > 0 || sub.streaming) ? (
              <ChatTranscript
                transcript={sub.transcript}
                streaming={sub.streaming}
                subagents={subagents}
              />
            ) : (
              <div className="chat-subagent-empty">Waiting for subagent…</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Shared transcript renderer. Markdown for assistant/user text; Skill and Task
// calls render inline (Task with a nested live subagent transcript); every other
// non-skill tool call collapses into one ToolActivityGroup. The model's pending
// ```options block is stripped from the shown text here; the clickable options
// themselves are rendered in the Canvas Artifact view (BrainstormCanvas).
export function ChatTranscript({
  transcript,
  streaming,
  subagents = {},
}: {
  transcript: ChatEntry[]
  streaming: string
  // Nested per-Task subagent transcripts, keyed by Task tool_use id. Passed
  // recursively so nested Task rows can resolve their own children.
  subagents?: Record<string, SubagentRun>
}) {
  const logRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  const lastAssistantIdx = transcript.map((e) => e.kind).lastIndexOf('assistant')

  // Walk the transcript, batching consecutive plain tool calls into a single
  // collapsed activity element. Skill and Task calls (and text entries) flush
  // the batch and render as their own inline element.
  const nodes: ReactNode[] = []
  let batch: ToolEntry[] = []
  const flushBatch = () => {
    if (batch.length === 0) return
    nodes.push(<ToolActivityGroup key={`act-${batch[0].id}`} entries={batch} />)
    batch = []
  }

  transcript.forEach((e, i) => {
    if (e.kind === 'tool' && e.name !== 'Skill' && e.name !== 'Task') {
      batch.push(e)
      return
    }
    flushBatch()
    if (e.kind === 'tool') {
      if (e.name === 'Task') {
        nodes.push(<TaskActivity key={e.id} entry={e} subagents={subagents} />)
      } else {
        nodes.push(<SkillCall key={e.id} entry={e} />)
      }
      return
    }
    const isLastAssistant = e.kind === 'assistant' && i === lastAssistantIdx
    // Strip the pending ```options block from the last assistant turn's shown
    // text; the options themselves render as cards in the Canvas Artifact view.
    const display = isLastAssistant ? parseOptions(e.text).display : e.text
    nodes.push(
      // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
      <div key={`e-${i}`} className={`chat-entry ${e.kind}`}>
        <Markdown remarkPlugins={[remarkGfm]}>{display}</Markdown>
      </div>,
    )
  })
  flushBatch()

  return (
    <div className="chat-log" ref={logRef}>
      {nodes}
      {streaming ? (
        <div className="chat-entry assistant">
          <Markdown remarkPlugins={[remarkGfm]}>{streaming}</Markdown>
          <span className="fx-wave" aria-hidden>
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : null}
    </div>
  )
}
