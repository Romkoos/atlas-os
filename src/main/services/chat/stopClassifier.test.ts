import { describe, expect, it } from 'vitest'
import {
  classifyStop,
  continuationPrompt,
  nextAutoContinueDelayMs,
  shouldStopAutoContinue,
} from './stopClassifier'

describe('classifyStop', () => {
  it('treats awaiting-input as clean', () => {
    expect(classifyStop({ type: 'awaiting-input' }, false)).toBe('clean')
  })
  it('treats a user-cancelled abort as clean', () => {
    expect(classifyStop({ type: 'aborted' }, true)).toBe('clean')
  })
  it('treats a non-user abort as unexpected', () => {
    expect(classifyStop({ type: 'aborted' }, false)).toBe('unexpected')
  })
  it('treats an error as unexpected', () => {
    expect(classifyStop({ type: 'error' }, false)).toBe('unexpected')
  })
  it('treats a rejected rate-limit as rate-limited', () => {
    expect(classifyStop({ type: 'rate-limit', status: 'rejected' }, false)).toBe('rate-limited')
  })
  it('treats an allowed rate-limit as clean (informational)', () => {
    expect(classifyStop({ type: 'rate-limit', status: 'allowed' }, false)).toBe('clean')
  })
  it('treats token/tool activity as clean (not a stop)', () => {
    expect(classifyStop({ type: 'token' }, false)).toBe('clean')
  })
})

describe('nextAutoContinueDelayMs', () => {
  it('waits until resetsAt when it is in the future', () => {
    expect(nextAutoContinueDelayMs({ resetsAt: 10_000, now: 4_000, attempt: 0 })).toBe(6_000)
  })
  it('returns a small floor when resetsAt is already past', () => {
    expect(nextAutoContinueDelayMs({ resetsAt: 1_000, now: 5_000, attempt: 0 })).toBe(1_000)
  })
  it('backs off exponentially when resetsAt is missing', () => {
    expect(nextAutoContinueDelayMs({ now: 0, attempt: 0 })).toBe(1_000)
    expect(nextAutoContinueDelayMs({ now: 0, attempt: 1 })).toBe(2_000)
    expect(nextAutoContinueDelayMs({ now: 0, attempt: 3 })).toBe(8_000)
  })
  it('caps the backoff at 60s', () => {
    expect(nextAutoContinueDelayMs({ now: 0, attempt: 20 })).toBe(60_000)
  })
})

describe('shouldStopAutoContinue', () => {
  it('allows retries below the cap', () => {
    expect(shouldStopAutoContinue(2)).toBe(false)
  })
  it('stops at the cap (default 3)', () => {
    expect(shouldStopAutoContinue(3)).toBe(true)
  })
  it('honours a custom cap', () => {
    expect(shouldStopAutoContinue(1, 1)).toBe(true)
  })
})

describe('continuationPrompt', () => {
  it('mentions git for the worker variant', () => {
    expect(continuationPrompt('worker').toLowerCase()).toContain('git')
  })
  it('is English and non-empty for the plain variant', () => {
    expect(continuationPrompt('plain').length).toBeGreaterThan(10)
  })
})
