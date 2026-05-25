// src/main/services/benchmark/gate.test.ts
import { checkRun, matchesAssertion } from '@main/services/benchmark/gate'
import { describe, expect, it } from 'vitest'

describe('matchesAssertion', () => {
  it('includes match is a case-sensitive substring', () => {
    expect(matchesAssertion('the infra.ts watcher', { type: 'includes', value: 'infra.ts' })).toBe(
      true,
    )
    expect(matchesAssertion('nothing here', { type: 'includes', value: 'infra.ts' })).toBe(false)
  })
  it('regex match is case-insensitive', () => {
    expect(matchesAssertion('Scope Regression', { type: 'regex', value: 'scope|regression' })).toBe(
      true,
    )
    expect(matchesAssertion('unrelated text', { type: 'regex', value: 'scope|regression' })).toBe(
      false,
    )
  })
  it('invalid regex pattern returns false instead of throwing', () => {
    expect(matchesAssertion('anything', { type: 'regex', value: '(unclosed' })).toBe(false)
  })
})

describe('checkRun', () => {
  const assert = { type: 'includes', value: 'infra.ts' } as const
  it('valid when success and assertion matches', () => {
    expect(
      checkRun({ subtype: 'success', resultText: 'see infra.ts', aborted: false }, assert),
    ).toEqual({
      valid: true,
      failReason: null,
    })
  })
  it('timeout when aborted', () => {
    expect(
      checkRun({ subtype: 'success', resultText: 'see infra.ts', aborted: true }, assert),
    ).toEqual({
      valid: false,
      failReason: 'timeout',
    })
  })
  it('sdk_error when subtype is not success', () => {
    expect(
      checkRun({ subtype: 'error_max_turns', resultText: '', aborted: false }, assert),
    ).toEqual({
      valid: false,
      failReason: 'sdk_error',
    })
  })
  it('assertion_failed when success but text does not match', () => {
    expect(
      checkRun({ subtype: 'success', resultText: 'wrong answer', aborted: false }, assert),
    ).toEqual({
      valid: false,
      failReason: 'assertion_failed',
    })
  })
})
