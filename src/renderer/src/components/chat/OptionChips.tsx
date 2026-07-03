// Clickable choices parsed from the model's turn-ending ```options block.
export function OptionChips({
  options,
  onPick,
}: {
  options: string[]
  onPick: (text: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div className="chat-chips">
      {options.map((opt) => (
        <button key={opt} type="button" className="chat-chip" onClick={() => onPick(opt)}>
          {opt}
        </button>
      ))}
    </div>
  )
}
