import { JobRegistry, trackJob } from '@main/services/jobs/registry'
import { describe, expect, it, vi } from 'vitest'

describe('JobRegistry', () => {
  it('exposes a registered job as running, with cancellable from abort', () => {
    const reg = new JobRegistry()
    reg.register({ kind: 'news', label: 'News digest', abort: () => {} })
    reg.register({ kind: 'knowledge.compile', label: 'Knowledge compile' })
    const { running } = reg.snapshot()
    expect(running).toHaveLength(2)
    expect(running.find((j) => j.kind === 'news')?.cancellable).toBe(true)
    expect(running.find((j) => j.kind === 'knowledge.compile')?.cancellable).toBe(false)
    expect(running[0].status).toBe('running')
    expect(running[0].endedAt).toBeNull()
  })

  it('moves a finished job into recent with status + endedAt', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'news', label: 'News digest' })
    job.finish('done')
    const snap = reg.snapshot()
    expect(snap.running).toHaveLength(0)
    expect(snap.recent).toHaveLength(1)
    expect(snap.recent[0].status).toBe('done')
    expect(snap.recent[0].endedAt).not.toBeNull()
    expect(snap.recent[0].cancellable).toBe(false)
  })

  it('is idempotent: finishing twice keeps a single recent entry', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'news', label: 'News digest' })
    job.finish('done')
    job.finish('error')
    expect(reg.snapshot().recent).toHaveLength(1)
    expect(reg.snapshot().recent[0].status).toBe('done')
  })

  it('caps recent at 10, newest first', () => {
    const reg = new JobRegistry()
    for (let i = 0; i < 12; i++) {
      reg.register({ kind: 'k', label: `job-${i}` }).finish('done')
    }
    const { recent } = reg.snapshot()
    expect(recent).toHaveLength(10)
    expect(recent[0].label).toBe('job-11')
    expect(recent[9].label).toBe('job-2')
  })

  it('cancel invokes abort and reports outcome', () => {
    const reg = new JobRegistry()
    const abort = vi.fn()
    const job = reg.register({ kind: 'news', label: 'News digest', abort })
    expect(reg.cancel(job.id)).toBe(true)
    expect(abort).toHaveBeenCalledOnce()
    expect(reg.cancel('nope')).toBe(false)
    const plain = reg.register({ kind: 'k', label: 'no-abort' })
    expect(reg.cancel(plain.id)).toBe(false)
  })

  it('notifies onChange listeners on register and finish, and unsubscribes', () => {
    const reg = new JobRegistry()
    const seen = vi.fn()
    const off = reg.onChange(seen)
    const job = reg.register({ kind: 'k', label: 'x' })
    job.finish('done')
    expect(seen).toHaveBeenCalledTimes(2)
    off()
    reg.register({ kind: 'k', label: 'y' })
    expect(seen).toHaveBeenCalledTimes(2)
  })
})

describe('trackJob', () => {
  it('finishes done and returns the resolved value', async () => {
    const reg = new JobRegistry()
    const result = await trackJob(
      reg,
      { kind: 'knowledge.compile', label: 'Knowledge compile' },
      Promise.resolve(42),
    )
    expect(result).toBe(42)
    expect(reg.snapshot().recent[0].status).toBe('done')
  })

  it('finishes error and re-throws on rejection', async () => {
    const reg = new JobRegistry()
    await expect(
      trackJob(
        reg,
        { kind: 'knowledge.compile', label: 'Knowledge compile' },
        Promise.reject(new Error('boom')),
      ),
    ).rejects.toThrow('boom')
    expect(reg.snapshot().recent[0].status).toBe('error')
  })
})
