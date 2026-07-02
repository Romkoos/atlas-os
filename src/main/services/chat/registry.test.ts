import { describe, expect, it, vi } from 'vitest'
import { ChatSessionRegistry } from './registry'
import type { ResumableRun } from './resumableRun'

function stubRun(): ResumableRun {
  return { reply: vi.fn(), cancel: vi.fn(), done: Promise.resolve() }
}

describe('ChatSessionRegistry', () => {
  it('builds a new run with resume=false when kickoff present', () => {
    const reg = new ChatSessionRegistry()
    let resumeSeen: boolean | undefined
    // biome-ignore lint/suspicious/noExplicitAny: collected envelopes
    const events: any[] = []
    reg.open(
      {
        sessionId: 's1',
        lastSeq: 0,
        kickoff: 'hi',
        resumable: true,
        buildRun: ({ resume, push }) => {
          resumeSeen = resume
          push({ type: 'token', text: 'a' })
          return stubRun()
        },
      },
      (env) => events.push(env),
    )
    expect(resumeSeen).toBe(false)
    expect(events).toEqual([{ seq: 1, event: { type: 'token', text: 'a' } }])
  })

  it('builds a resume run (resume=true) when no kickoff and no live record', () => {
    const reg = new ChatSessionRegistry()
    let resumeSeen: boolean | undefined
    reg.open(
      {
        sessionId: 's2',
        lastSeq: 0,
        resumable: true,
        buildRun: ({ resume, push }) => {
          resumeSeen = resume
          push({ type: 'awaiting-input' })
          return stubRun()
        },
      },
      () => {},
    )
    expect(resumeSeen).toBe(true)
  })

  it('replays only the gap on reattach and does not rebuild the run', () => {
    const reg = new ChatSessionRegistry()
    let builds = 0
    let push!: (e: unknown) => void
    reg.open(
      {
        sessionId: 's3',
        lastSeq: 0,
        kickoff: 'hi',
        resumable: true,
        buildRun: (a) => {
          builds++
          push = a.push
          return stubRun()
        },
      },
      () => {},
    )
    push({ type: 'token', text: 'x' }) // seq 1
    push({ type: 'token', text: 'y' }) // seq 2
    // biome-ignore lint/suspicious/noExplicitAny: collected envelopes
    const replayed: any[] = []
    reg.open(
      { sessionId: 's3', lastSeq: 1, resumable: true, buildRun: () => stubRun() },
      (env) => replayed.push(env),
    )
    expect(builds).toBe(1) // no rebuild
    expect(replayed).toEqual([{ seq: 2, event: { type: 'token', text: 'y' } }])
  })

  it('emits aborted and starts nothing for a non-resumable dead session', () => {
    const reg = new ChatSessionRegistry()
    let built = false
    // biome-ignore lint/suspicious/noExplicitAny: collected envelopes
    const events: any[] = []
    reg.open(
      {
        sessionId: 's4',
        lastSeq: 0,
        resumable: false,
        buildRun: () => {
          built = true
          return stubRun()
        },
      },
      (env) => events.push(env),
    )
    expect(built).toBe(false)
    expect(events).toEqual([{ seq: 1, event: { type: 'aborted' } }])
  })

  it('teardown detaches without cancelling the run', () => {
    const reg = new ChatSessionRegistry()
    const run = stubRun()
    const teardown = reg.open(
      { sessionId: 's5', lastSeq: 0, kickoff: 'hi', resumable: true, buildRun: () => run },
      () => {},
    )
    teardown()
    expect(run.cancel).not.toHaveBeenCalled()
    expect(reg.reply('s5', 'later')).toBe(true) // record still alive
  })
})
