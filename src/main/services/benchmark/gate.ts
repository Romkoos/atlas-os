// src/main/services/benchmark/gate.ts
import type { Assertion, FailReason } from '@main/services/benchmark/types'

export function matchesAssertion(text: string, assert: Assertion): boolean {
  if (assert.type === 'includes') return text.includes(assert.value)
  try {
    return new RegExp(assert.value, 'i').test(text)
  } catch {
    return false // invalid regex pattern → treat as no match
  }
}

export interface GateInput {
  subtype: string
  resultText: string
  aborted: boolean
}

export function checkRun(
  input: GateInput,
  assert: Assertion,
): { valid: boolean; failReason: FailReason | null } {
  if (input.aborted) return { valid: false, failReason: 'timeout' }
  if (input.subtype !== 'success') return { valid: false, failReason: 'sdk_error' }
  if (!matchesAssertion(input.resultText, assert))
    return { valid: false, failReason: 'assertion_failed' }
  return { valid: true, failReason: null }
}
