import type { ChatEntry } from '@renderer/store/createChatRunStore'
import { parseOptions } from './parseOptions'

// Pure derivation for the Canvas Artifact view: find the last assistant turn,
// parse its ```options block, and surface the clickable options only when the
// run is actually awaiting a pick (awaitingInput && not mid-stream) — the same
// gate the inline OptionChips used. The parsed `display` (block stripped) is
// always returned so the view can show the current question text.
export function deriveArtifact({
  transcript,
  streaming,
  awaitingInput,
}: {
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
}): { display: string; options: string[] } {
  const lastAssistant = [...transcript].reverse().find((e) => e.kind === 'assistant')
  if (!lastAssistant) return { display: '', options: [] }
  const { display, options } = parseOptions(lastAssistant.text)
  const gated = awaitingInput && !streaming
  return { display, options: gated ? options : [] }
}
