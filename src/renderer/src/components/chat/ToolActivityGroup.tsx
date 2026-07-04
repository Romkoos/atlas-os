import type { ChatEntry } from '@renderer/store/createChatRunStore'
import { Check, ChevronRight, Loader2, Terminal, X } from 'lucide-react'
import { useState } from 'react'

type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>

// One row inside the activity group: a tool call, expandable to its raw output.
function ToolRow({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false)
  const hasBody = Boolean(entry.resultText)
  return (
    <div className={`chat-tool-row ${entry.status}`}>
      <button
        type="button"
        className="chat-tool-row-head"
        onClick={() => hasBody && setOpen((o) => !o)}
        disabled={!hasBody}
      >
        {entry.status === 'running' ? (
          <Loader2 size={12} className="chat-spin" />
        ) : entry.status === 'error' ? (
          <X size={12} />
        ) : (
          <Check size={12} />
        )}
        <span className="chat-tool-row-label">{entry.text}</span>
        {hasBody ? <ChevronRight size={12} className={`chat-chev${open ? ' open' : ''}`} /> : null}
      </button>
      {open && entry.resultText ? <pre className="chat-tool-out">{entry.resultText}</pre> : null}
    </div>
  )
}

// All non-skill tool calls + system activity collapsed into a SINGLE element.
// Collapsed it shows a live status (the running tool, or a completed count);
// expanded it reveals a scrollable list of every call, each drillable to output.
export function ToolActivityGroup({ entries }: { entries: ToolEntry[] }) {
  const [open, setOpen] = useState(false)
  const running = entries.find((e) => e.status === 'running')
  const errored = entries.some((e) => e.status === 'error')
  const label = running
    ? running.text
    : `${entries.length} tool call${entries.length === 1 ? '' : 's'}`

  return (
    <div className={`chat-activity${errored ? ' has-error' : ''}`}>
      <button type="button" className="chat-activity-head" onClick={() => setOpen((o) => !o)}>
        {running ? <Loader2 size={13} className="chat-spin" /> : <Terminal size={13} />}
        <span className="chat-activity-label">{label}</span>
        <ChevronRight size={13} className={`chat-chev${open ? ' open' : ''}`} />
      </button>
      {open ? (
        <div className="chat-activity-body">
          {entries.map((e) => (
            <ToolRow key={e.id} entry={e} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
