// Clickable choices parsed from the model's turn-ending ```options block.
// Rendered as a vertical list of sharp terminal-style rows (matching the app's
// 0-radius amber aesthetic). Picking one sends it as the reply — the chosen text
// then appears as the user's message and these disappear.
export function OptionChips({
  options,
  onPick,
}: {
  options: string[]
  onPick: (text: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="chat-options">
      {options.map((opt) => (
        <button key={opt} type="button" className="chat-option" onClick={() => onPick(opt)}>
          <span className="chat-option-caret">›</span>
          <span>{opt}</span>
        </button>
      ))}
    </div>
  )
}
