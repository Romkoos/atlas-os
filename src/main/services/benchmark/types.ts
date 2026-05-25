// src/main/services/benchmark/types.ts

export interface Assertion {
  type: 'includes' | 'regex'
  value: string
}

export interface BenchmarkTask {
  id: string
  prompt: string
  assert: Assertion
}

export type FailReason = 'sdk_error' | 'assertion_failed' | 'timeout'

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
