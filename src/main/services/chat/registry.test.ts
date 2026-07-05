import { describe, expect, it, vi } from 'vitest'
import { ChatSessionRegistry } from './registry'
import type { ResumableRun } from './resumableRun'

// A fake run whose push() we drive manually. buildRun records how many times it
// was (re)built and with what args.
function fakeRunFactory() {
  const builds: Array<{ resume: boolean; resumeMessage?: string }> = []
  let lastPush: ((e: unknown) => void) | null = null
  const buildRun = vi.fn(
    (args: {
      resume: boolean
      kickoff?: string
      resumeMessage?: string
      push: (e: unknown) => void
    }): ResumableRun => {
      builds.push({ resume: args.resume, resumeMessage: args.resumeMessage })
      lastPush = args.push
      return { reply: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), done: Promise.resolve() }
    },
  )
  return { builds, buildRun, push: (e: unknown) => lastPush?.(e) }
}

describe('ChatSessionRegistry auto-continue', () => {
  it('rebuilds the run with a continuation on an unexpected stop while working', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    reg.open(
      {
        sessionId: 's1',
        lastSeq: 0,
        kickoff: 'do the thing',
        resumable: true,
        continuationKind: 'worker',
        buildRun: f.buildRun,
      },
      () => {},
    )
    // Simulate work then an unexpected error.
    f.push({ type: 'tool', name: 'Bash', summary: 'git status', toolId: 't1' })
    f.push({ type: 'error', message: 'Chat stream ended unexpectedly' })
    expect(f.builds.length).toBe(2)
    expect(f.builds[1].resume).toBe(true)
    expect(f.builds[1].resumeMessage).toContain('git')
  })

  it('stops after the loop-guard cap of consecutive no-progress retries', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    const events: unknown[] = []
    reg.open(
      {
        sessionId: 's2',
        lastSeq: 0,
        kickoff: 'go',
        resumable: true,
        continuationKind: 'plain',
        buildRun: f.buildRun,
      },
      (env) => events.push(env.event),
    )
    // Three errors with no progress in between → 3rd should give up (terminal error).
    f.push({ type: 'error', message: 'boom' }) // build #2
    f.push({ type: 'error', message: 'boom' }) // build #3
    f.push({ type: 'error', message: 'boom' }) // cap reached → terminal, no build #4
    expect(f.builds.length).toBe(3)
    expect(events.some((e) => (e as { type: string }).type === 'error')).toBe(true)
  })

  it('treats awaiting-input as a clean pause (no rebuild)', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    reg.open(
      {
        sessionId: 's3',
        lastSeq: 0,
        kickoff: 'go',
        resumable: true,
        continuationKind: 'plain',
        buildRun: f.buildRun,
      },
      () => {},
    )
    f.push({ type: 'awaiting-input' })
    expect(f.builds.length).toBe(1)
  })

  it('finalizes without rebuilding on an unexpected stop when resumable is false', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    const events: unknown[] = []
    reg.open(
      {
        sessionId: 's4',
        lastSeq: 0,
        kickoff: 'skill-id',
        resumable: false,
        continuationKind: 'plain',
        buildRun: f.buildRun,
      },
      (env) => events.push(env.event),
    )
    f.push({ type: 'error', message: 'Chat run failed: boom' })
    expect(f.builds.length).toBe(1)
    expect(events).toContainEqual({
      type: 'error',
      message: 'Chat run failed and cannot be resumed',
    })
  })
})
