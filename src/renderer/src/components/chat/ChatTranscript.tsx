import type { ChatEntry } from '@renderer/store/createChatRunStore'
import { useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { OptionChips } from './OptionChips'
import { parseOptions } from './parseOptions'
import { ToolCallCard } from './ToolCallCard'

// Shared transcript renderer for every chat type: markdown for assistant/user
// text, ToolCallCard for tool entries, and option chips parsed from the last
// assistant turn. `onPickOption` sends the chosen chip text as the next reply.
export function ChatTranscript({
  transcript,
  streaming,
  onPickOption,
}: {
  transcript: ChatEntry[]
  streaming: string
  onPickOption: (text: string) => void
}) {
  const logRef = useRef<HTMLDivElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new output
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [transcript, streaming])

  const lastAssistantIdx = transcript.map((e) => e.kind).lastIndexOf('assistant')

  return (
    <div className="chat-log" ref={logRef}>
      {transcript.map((e, i) => {
        if (e.kind === 'tool') {
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
          return <ToolCallCard key={i} entry={e} />
        }
        const isLastAssistant = e.kind === 'assistant' && i === lastAssistantIdx
        const { display, options } = isLastAssistant
          ? parseOptions(e.text)
          : { display: e.text, options: [] as string[] }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only transcript
          <div key={i} className={`chat-entry ${e.kind}`}>
            <Markdown remarkPlugins={[remarkGfm]}>{display}</Markdown>
            {isLastAssistant && !streaming ? (
              <OptionChips options={options} onPick={onPickOption} />
            ) : null}
          </div>
        )
      })}
      {streaming ? (
        <div className="chat-entry assistant">
          <Markdown remarkPlugins={[remarkGfm]}>{streaming}</Markdown>
        </div>
      ) : null}
    </div>
  )
}
