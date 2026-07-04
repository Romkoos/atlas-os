import type { ChatEntry } from '@renderer/store/createChatRunStore'
import { Loader2, Zap } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { OptionChips } from './OptionChips'
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

// Shared transcript renderer. Markdown for assistant/user text; all non-skill
// tool calls collapse into one ToolActivityGroup; skill calls render inline.
// Option chips show only while awaiting input on the last assistant turn.
export function ChatTranscript({
  transcript,
  streaming,
  awaitingInput,
  onPickOption,
}: {
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  onPickOption: (text: string) => void
}) {
  const logRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  const lastAssistantIdx = transcript.map((e) => e.kind).lastIndexOf('assistant')

  // Walk the transcript, batching consecutive non-skill tool calls into a single
  // collapsed activity element. Skill calls and text entries flush the batch.
  const nodes: ReactNode[] = []
  let batch: ToolEntry[] = []
  const flushBatch = () => {
    if (batch.length === 0) return
    nodes.push(<ToolActivityGroup key={`act-${batch[0].id}`} entries={batch} />)
    batch = []
  }

  transcript.forEach((e, i) => {
    if (e.kind === 'tool' && e.name !== 'Skill') {
      batch.push(e)
      return
    }
    flushBatch()
    if (e.kind === 'tool') {
      nodes.push(<SkillCall key={e.id} entry={e} />)
      return
    }
    const isLastAssistant = e.kind === 'assistant' && i === lastAssistantIdx
    const { display, options } = isLastAssistant
      ? parseOptions(e.text)
      : { display: e.text, options: [] as string[] }
    nodes.push(
      // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
      <div key={`e-${i}`} className={`chat-entry ${e.kind}`}>
        <Markdown remarkPlugins={[remarkGfm]}>{display}</Markdown>
        {isLastAssistant && awaitingInput && !streaming ? (
          <OptionChips options={options} onPick={onPickOption} />
        ) : null}
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
        </div>
      ) : null}
    </div>
  )
}
