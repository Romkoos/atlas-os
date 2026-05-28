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
  // True when the run produced ZERO result messages (no turns, no duration).
  // An `aborted` flag with no progress means the SDK gave up before the first
  // response — not the 5-minute wall-clock timer. Classifying it as `timeout`
  // is misleading; surface it as sdk_error instead. Caller (runner) sets this.
  noProgress?: boolean
}

// Claude subscription session/usage limits surface as a normal `subtype:'success'`
// response whose text is a server message (e.g. "You've hit your session limit ·
// resets 6:20pm"). Catch them BEFORE the assertion check so the row is classified
// honestly (rate_limited, not assertion_failed) and clearly excluded from data.
//
// The patterns are intentionally narrow — must match Anthropic's canonical wording.
// The earlier loose `rate.?limit` alternative produced false positives when tasks
// like `git-recent-touch` surfaced commit subjects containing "rate_limited"
// (e.g. `feat(benchmark): classify ... rate_limited`), wrongly marking a
// successful run as rate-limited. Require "hit your <session|usage> limit" AND/OR
// the reset-timestamp phrasing, both of which are vanishingly unlikely to appear
// in real model output except as a verbatim server message.
const RATE_LIMIT_RE =
  /hit your (session|usage) limit|resets at \d{1,2}(:\d{2})?\s*(am|pm)|limit\s*·\s*resets\s+\d{1,2}/i

export function checkRun(
  input: GateInput,
  assert: Assertion,
): { valid: boolean; failReason: FailReason | null } {
  if (input.aborted) {
    // Aborted with zero progress ≠ wall-clock timeout — the 5-minute timer
    // cannot have fired at 0ms. The SDK aborted internally (transient
    // network / OAuth handshake / cooldown). Surface as sdk_error so the
    // honest-failure count stays meaningful.
    if (input.noProgress) return { valid: false, failReason: 'sdk_error' }
    return { valid: false, failReason: 'timeout' }
  }
  if (input.subtype !== 'success') return { valid: false, failReason: 'sdk_error' }
  // Length guard: real Anthropic limit responses are short (~60-200 chars of
  // canned server text). When a task LEGITIMATELY surfaces the phrase — e.g.
  // git-recent-touch reads gate.test.ts which contains the example string
  // verbatim — the response is hundreds-to-thousands of chars long and the
  // RATE_LIMIT_RE match is a code citation, not a real limit hit. Only treat
  // matches in short responses as real rate-limit events.
  if (input.resultText.length < 500 && RATE_LIMIT_RE.test(input.resultText))
    return { valid: false, failReason: 'rate_limited' }
  if (!matchesAssertion(input.resultText, assert))
    return { valid: false, failReason: 'assertion_failed' }
  return { valid: true, failReason: null }
}
