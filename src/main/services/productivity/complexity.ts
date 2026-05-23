import type { AgentTurn } from '@main/services/productivity/transcript'

// Subjective-effort proxy on a 1–5 scale.
//
// STUB: returns the middle value for every turn. A real heuristic
// (f(turn_count, distinct_tools, files_touched, tokens)) will replace this
// later — see docs/agent-productivity-tracker.md "Открытые вопросы". The
// signature is intentionally stable so the ingest pipeline does not change
// when the formula lands.
export function complexityProxy(_turn: AgentTurn): number {
  return 3
}
