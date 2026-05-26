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

// Claude subscription session/usage limits surface as a normal `subtype:'success'`
// response whose text is a server message (e.g. "You've hit your session limit ·
// resets 6:20pm"). Catch them BEFORE the assertion check so the row is classified
// honestly (rate_limited, not assertion_failed) and clearly excluded from data.
const RATE_LIMIT_RE =
  /hit your (session|usage) limit|rate.?limit|resets \d{1,2}(:\d{2})?\s*(am|pm)/i

export function checkRun(
  input: GateInput,
  assert: Assertion,
): { valid: boolean; failReason: FailReason | null } {
  if (input.aborted) return { valid: false, failReason: 'timeout' }
  if (input.subtype !== 'success') return { valid: false, failReason: 'sdk_error' }
  if (RATE_LIMIT_RE.test(input.resultText)) return { valid: false, failReason: 'rate_limited' }
  if (!matchesAssertion(input.resultText, assert))
    return { valid: false, failReason: 'assertion_failed' }
  return { valid: true, failReason: null }
}
