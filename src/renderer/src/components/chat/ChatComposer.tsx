import { useState } from 'react'

// Message input, rendered as a flex-none footer so it always sits at the bottom
// of the chat body — including when the transcript is empty. Enter sends,
// Shift+Enter inserts a newline.
export function ChatComposer({
  disabled,
  placeholder,
  onSend,
}: {
  disabled: boolean
  placeholder: string
  onSend: (text: string) => void
}) {
  const [draft, setDraft] = useState('')
  const send = () => {
    const text = draft.trim()
    if (!text || disabled) return
    onSend(text)
    setDraft('')
  }
  return (
    <div className="chat-composer">
      <textarea
        className="input"
        rows={2}
        value={draft}
        placeholder={placeholder}
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
        disabled={disabled || !draft.trim()}
        onClick={send}
      >
        send
      </button>
    </div>
  )
}
