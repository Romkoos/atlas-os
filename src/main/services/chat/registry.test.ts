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

  it('nudgeStalled rebuilds any run still in the running state (system-wake nudge)', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    reg.open(
      {
        sessionId: 's5',
        lastSeq: 0,
        kickoff: 'do the thing',
        resumable: true,
        continuationKind: 'worker',
        buildRun: f.buildRun,
      },
      () => {},
    )
    // Still "running" (no awaiting-input/done/error yet) — as if the stream died
    // silently during sleep without tripping the stall watchdog.
    expect(f.builds.length).toBe(1)
    reg.nudgeStalled()
    expect(f.builds.length).toBe(2)
    expect(f.builds[1].resume).toBe(true)
  })

  it('honors the rate-limit reset wait despite the trailing turn error', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    const events: unknown[] = []
    reg.open(
      {
        sessionId: 's6',
        lastSeq: 0,
        kickoff: 'do the thing',
        resumable: true,
        continuationKind: 'worker',
        buildRun: f.buildRun,
      },
      (env) => events.push(env.event),
    )
    // Subscription limit: rejection schedules a reset-timed resume far in the
    // future, then the SDK emits a trailing non-success result (error) for the
    // same turn — which must NOT cancel the timer and retry immediately.
    const resetsAt = Date.now() + 3_600_000 // 1h out ⇒ setTimeout, nothing fires sync
    f.push({ type: 'rate-limit', status: 'rejected', resetsAt })
    f.push({ type: 'error', message: 'Chat run failed' })
    expect(f.builds.length).toBe(1) // no synchronous rebuild
    expect(events.some((e) => (e as { type: string }).type === 'limited')).toBe(true)
    expect(
      events.some(
        (e) =>
          (e as { type: string; message?: string }).type === 'error' &&
          (e as { message?: string }).message === 'Auto-continue gave up after repeated failures',
      ),
    ).toBe(false)
  })

  it('nudgeStalled skips a non-resumable running session', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    reg.open(
      {
        sessionId: 's7',
        lastSeq: 0,
        kickoff: 'skill-id',
        resumable: false,
        continuationKind: 'plain',
        buildRun: f.buildRun,
      },
      () => {},
    )
    expect(f.builds.length).toBe(1)
    reg.nudgeStalled()
    expect(f.builds.length).toBe(1) // skipped — non-resumable must not be rebuilt
  })
})

// The session-lifecycle job is registered once and reused across every
// auto-continue, then finished exactly once — so a supersede (dispose + rebuild)
// can never leave a phantom "running" job behind in the Processes panel.
describe('ChatSessionRegistry session job', () => {
  function fakeJob() {
    const finish = vi.fn()
    return { finish, register: vi.fn(() => ({ id: 'job-1', update: vi.fn(), finish })) }
  }

  function openWithJob(
    reg: ChatSessionRegistry,
    sessionId: string,
    f: ReturnType<typeof fakeRunFactory>,
    j: ReturnType<typeof fakeJob>,
  ) {
    reg.open(
      {
        sessionId,
        lastSeq: 0,
        kickoff: 'go',
        resumable: true,
        continuationKind: 'plain',
        registerJob: j.register,
        buildRun: f.buildRun,
      },
      () => {},
    )
  }

  it('registers the job once and keeps it across auto-continues (no orphan)', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    const j = fakeJob()
    openWithJob(reg, 'j1', f, j)
    f.push({ type: 'error', message: 'boom' }) // auto-continue #1 (dispose + rebuild)
    f.push({ type: 'tool', name: 'Bash', summary: 'x', toolId: 't1' }) // progress resets guard
    f.push({ type: 'error', message: 'boom' }) // auto-continue #2
    expect(f.builds.length).toBe(3) // three runs...
    expect(j.register).toHaveBeenCalledTimes(1) // ...but a single job
    expect(j.finish).not.toHaveBeenCalled() // still running through the retries
  })

  it('finishes the job as cancelled on user cancel (no Signal), only once', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    const j = fakeJob()
    openWithJob(reg, 'j2', f, j)
    reg.cancel('j2')
    expect(j.finish).toHaveBeenCalledTimes(1)
    expect(j.finish).toHaveBeenCalledWith('cancelled')
    // A trailing async `aborted` re-entering finalize must not double-finish.
    f.push({ type: 'aborted' })
    expect(j.finish).toHaveBeenCalledTimes(1)
  })

  it('finishes the job as error when auto-continue gives up', () => {
    const reg = new ChatSessionRegistry()
    const f = fakeRunFactory()
    const j = fakeJob()
    openWithJob(reg, 'j3', f, j)
    f.push({ type: 'error', message: 'boom' })
    f.push({ type: 'error', message: 'boom' })
    f.push({ type: 'error', message: 'boom' }) // cap → give up
    expect(j.finish).toHaveBeenCalledTimes(1)
    expect(j.finish).toHaveBeenCalledWith('error')
  })
})
