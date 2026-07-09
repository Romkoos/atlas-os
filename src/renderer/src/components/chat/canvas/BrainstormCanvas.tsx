import type { ChatSessionType } from '@renderer/store/chats'
import { useActiveChatArtifact } from '../useActiveChatArtifact'

// Canvas "Artifact" view: renders the model's CURRENT pending options prompt as
// clickable cards instead of inline chat chips. Single active question only —
// history/decision-map are fast-follow. Non-option states show a quiet,
// situation-specific placeholder rather than an empty card frame.
export function BrainstormCanvas({ type }: { type: ChatSessionType }) {
  const { started, streaming, awaitingInput, display, options, onPick } =
    useActiveChatArtifact(type)

  if (options.length > 0) {
    return (
      <div className="brainstorm">
        {display ? <div className="brainstorm-question">{display}</div> : null}
        <div className="brainstorm-options">
          {options.map((opt) => (
            <button key={opt} type="button" className="brainstorm-card" onClick={() => onPick(opt)}>
              <span className="brainstorm-card-caret">›</span>
              <span>{opt}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const message = !started
    ? 'No active brainstorm.'
    : streaming
      ? 'Agent is thinking…'
      : awaitingInput
        ? 'Waiting for your reply in chat.'
        : 'Agent is thinking…'

  return <div className="canvas-empty">{message}</div>
}
