// src/main/services/benchmark/types.ts

export interface Assertion {
  type: 'includes' | 'regex'
  value: string
}

export interface BenchmarkTask {
  id: string
  // Human-friendly label shown in the UI (falls back to `id` if absent). `id`
  // stays the stable machine key — DB rows reference it forever.
  name?: string
  // One-paragraph plain-language explanation of what the task probes — shown on
  // hover via the info icon next to the name in the results table.
  description?: string
  prompt: string
  // Additional user turns sent IN THE SAME SESSION (via SDK `resume`), so the
  // prefix is created once and read across turns — models a real coding session
  // and lets us measure amortized cost. Assertion is checked against the final
  // turn's response. If absent, the task is a single-turn (current behavior).
  followUps?: string[]
  assert: Assertion
}

export type FailReason = 'sdk_error' | 'assertion_failed' | 'timeout' | 'rate_limited'

export interface RunResult {
  taskId: string
  model: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  cacheCreationTokens: number
  totalCostUsd: number
  numTurns: number
  durationMs: number
  success: boolean
  failReason: FailReason | null
  sessionId: string | null
}
