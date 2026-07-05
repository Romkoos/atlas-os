import { TermSelect } from '@renderer/components/ui/select'
import { trpc } from '@renderer/lib/trpc'
import { CLAUDE_MODELS, type ClaudeModelId, DEFAULT_MODEL_ID } from '@shared/models'

// Model picker for a new chat's intro screen. `value === null` means "use the
// global default"; we still render that default as the selected option so the
// user sees which model the chat will run on. Picking an option pins the chat
// to that model for its lifetime.
export function ChatModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: ClaudeModelId | null
  onChange: (model: ClaudeModelId) => void
  disabled?: boolean
}) {
  const settings = trpc.settings.get.useQuery()
  const effective = value ?? settings.data?.model ?? DEFAULT_MODEL_ID
  return (
    <div className="label-block">
      <span className="rm-field-label">model</span>
      <TermSelect
        value={effective}
        onValueChange={(v) => onChange(v as ClaudeModelId)}
        disabled={disabled}
        style={{ width: '100%' }}
        options={CLAUDE_MODELS.map((m) => ({ value: m.id, label: m.label }))}
      />
    </div>
  )
}
