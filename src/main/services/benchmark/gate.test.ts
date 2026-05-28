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
  it('timeout when aborted after some progress (5-min wall-clock)', () => {
    expect(
      checkRun({ subtype: 'success', resultText: 'see infra.ts', aborted: true }, assert),
    ).toEqual({
      valid: false,
      failReason: 'timeout',
    })
  })
  it('sdk_error when aborted with zero progress (SDK gave up before first turn)', () => {
    expect(
      checkRun({ subtype: 'error', resultText: '', aborted: true, noProgress: true }, assert),
    ).toEqual({
      valid: false,
      failReason: 'sdk_error',
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
  it('rate_limited when the response is a short canonical session-limit message', () => {
    expect(
      checkRun(
        {
          subtype: 'success',
          resultText: "You've hit your session limit · resets 6:20pm (Asia/Jerusalem)",
          aborted: false,
        },
        assert,
      ),
    ).toEqual({ valid: false, failReason: 'rate_limited' })
  })
  it('NOT rate_limited when limit phrase is cited in long task output', () => {
    // Length guard prevents false positives when tasks like git-recent-touch
    // surface gate.test.ts or commit messages that include the canonical
    // limit phrase as documentation.
    const longResponse =
      'Recent commit summaries for the benchmark module:\n\n' +
      "1. gate.ts: added detection for `You've hit your session limit · resets 6:20pm` style server messages so the runner classifies subscription cooldowns honestly instead of treating them as assertion failures.\n" +
      '2. runner.ts: aggregates token + cache + duration metrics across all turns of a session via the agent SDK resume mechanism.\n' +
      '3. types.ts: declared the FailReason union including rate_limited / sdk_error / timeout / assertion_failed.\n\n' +
      'These changes implement the infra.ts watcher updates required for benchmark stability across infra changes. The full text of the canonical server message is documented in the source comments. infra.ts is the central watcher file in this codebase and is referenced throughout the benchmark module.'
    expect(
      checkRun(
        { subtype: 'success', resultText: longResponse, aborted: false },
        { type: 'includes', value: 'infra.ts' },
      ),
    ).toEqual({ valid: true, failReason: null })
  })
})
