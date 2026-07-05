// Single source of truth for Claude model IDs (used by main + renderer).
// IDs verified against Anthropic's current model line (Claude 5 / Opus 4.8 family).
export interface ClaudeModel {
  readonly id: string
  readonly label: string
}

export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
] as const satisfies readonly ClaudeModel[]

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id']

export const CLAUDE_MODEL_IDS = CLAUDE_MODELS.map((m) => m.id) as [
  ClaudeModelId,
  ...ClaudeModelId[],
]

// Default = the current Sonnet (best speed/intelligence balance).
export const DEFAULT_MODEL_ID: ClaudeModelId = 'claude-sonnet-5'

export function isClaudeModelId(value: string): value is ClaudeModelId {
  return (CLAUDE_MODEL_IDS as readonly string[]).includes(value)
}
