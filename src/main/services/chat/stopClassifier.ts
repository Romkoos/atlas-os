// Pure decision helpers for the durable-run controller. No SDK / IO here so the
// registry's auto-continue policy is unit-testable in isolation.

export type StopKind = 'clean' | 'unexpected' | 'rate-limited'

const AUTO_CONTINUE_CAP = 3
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 60_000
const RESET_FLOOR_MS = 1_000

// Classify a run event as a stop signal. `clean` = a normal pause (awaiting the
// user) or a user-initiated cancel; `rate-limited` = the SDK rejected us and we
// must wait for the window to reset; `unexpected` = an error / stall / non-user
// abort that we should auto-continue. Anything that is not a stop is `clean`.
export function classifyStop(
  event: { type: string; status?: string },
  userCancelled: boolean,
): StopKind {
  if (event.type === 'rate-limit') {
    return event.status === 'rejected' ? 'rate-limited' : 'clean'
  }
  if (event.type === 'error') return 'unexpected'
  if (event.type === 'aborted') return userCancelled ? 'clean' : 'unexpected'
  return 'clean'
}

// How long to wait before the next auto-continue. Prefer the SDK-reported
// resetsAt (epoch ms); if absent, exponential backoff capped at 60s.
export function nextAutoContinueDelayMs(input: {
  resetsAt?: number
  now: number
  attempt: number
}): number {
  if (typeof input.resetsAt === 'number') {
    return Math.max(RESET_FLOOR_MS, input.resetsAt - input.now)
  }
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** input.attempt)
}

// Stop auto-continuing once we have retried `cap` times without any new
// assistant/tool activity — guards against an agent that instantly re-errors.
export function shouldStopAutoContinue(noProgressCount: number, cap = AUTO_CONTINUE_CAP): boolean {
  return noProgressCount >= cap
}

// The synthetic user message seeded into the mailbox on auto-continue.
export function continuationPrompt(kind: 'worker' | 'plain'): string {
  if (kind === 'worker') {
    return [
      'The previous turn was interrupted (app restart, sleep, or a rate limit).',
      'Continue the task you were working on. First re-check the current repo',
      'state (`git status` / `git diff`) to see what you already changed, then',
      'pick up exactly where you left off. Do not repeat work already done and',
      'do not start over. English only.',
    ].join(' ')
  }
  return [
    'The previous turn was interrupted. Continue where you left off and finish',
    'the task you were working on, without repeating work already done.',
  ].join(' ')
}
