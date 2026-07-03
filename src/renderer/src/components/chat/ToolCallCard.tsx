import type { ChatEntry } from '@renderer/store/createChatRunStore'
import { Check, ChevronRight, Loader2, X } from 'lucide-react'
import { useState } from 'react'

type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>

// Collapsible tool call: a loader while the tool runs, then a clickable row that
// expands to the real tool output. Replaces the old one-line `· summary` text.
export function ToolCallCard({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false)
  const hasBody = Boolean(entry.resultText)
  return (
    <div className={`chat-tool ${entry.status}`}>
      <button
        type="button"
        className="chat-tool-head"
        onClick={() => hasBody && setOpen((o) => !o)}
        disabled={!hasBody}
      >
        {entry.status === 'running' ? (
          <Loader2 size={13} className="chat-tool-spin" />
        ) : entry.status === 'error' ? (
          <X size={13} />
        ) : (
          <Check size={13} />
        )}
        <span className="chat-tool-label">{entry.text}</span>
        {hasBody ? (
          <ChevronRight size={13} className={`chat-tool-chev${open ? ' open' : ''}`} />
        ) : null}
      </button>
      {open && entry.resultText ? <pre className="chat-tool-body">{entry.resultText}</pre> : null}
    </div>
  )
}
