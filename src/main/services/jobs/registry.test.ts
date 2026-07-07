import { JobRegistry, trackJob } from '@main/services/jobs/registry'
import { recordSignal } from '@main/services/signals/registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/signals/registry', () => ({ recordSignal: vi.fn() }))
const mockedRecordSignal = vi.mocked(recordSignal)

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

describe('JobRegistry Signals', () => {
  beforeEach(() => mockedRecordSignal.mockClear())

  it('records a job.failed Signal on error', () => {
    const reg = new JobRegistry()
    reg.register({ kind: 'general.chat', label: 'General chat' }).finish('error')
    expect(mockedRecordSignal).toHaveBeenCalledTimes(1)
    expect(mockedRecordSignal.mock.calls[0][0]).toMatchObject({
      type: 'job.failed',
      title: 'General chat failed',
    })
  })

  it('records NO Signal on a user-initiated cancel', () => {
    const reg = new JobRegistry()
    reg.register({ kind: 'general.chat', label: 'General chat' }).finish('cancelled')
    expect(mockedRecordSignal).not.toHaveBeenCalled()
    // still lands in recent, so the panel can show it neutrally
    expect(reg.snapshot().recent[0].status).toBe('cancelled')
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

describe('JobRegistry meta', () => {
  it('exposes model and detail from register on running jobs', () => {
    const reg = new JobRegistry()
    reg.register({ kind: 'news', label: 'News digest', model: 'claude-sonnet-4-6', detail: 'seed' })
    const j = reg.snapshot().running[0]
    expect(j.model).toBe('claude-sonnet-4-6')
    expect(j.detail).toBe('seed')
    expect(j.tokens).toBeNull()
    expect(j.resultPath).toBeNull()
    expect(j.error).toBeNull()
  })

  it('update() mutates detail/tokens on the active job and emits change', () => {
    const reg = new JobRegistry()
    const seen = vi.fn()
    reg.onChange(seen)
    const job = reg.register({ kind: 'benchmark', label: 'Benchmark batch' })
    seen.mockClear()
    job.update({ detail: '2/5 · running', tokens: 100 })
    const j = reg.snapshot().running[0]
    expect(j.detail).toBe('2/5 · running')
    expect(j.tokens).toBe(100)
    expect(seen).toHaveBeenCalledTimes(1)
    // partial update leaves the untouched field as-is
    job.update({ detail: '3/5 · running' })
    expect(reg.snapshot().running[0].tokens).toBe(100)
  })

  it('update() after finish is a no-op', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'k', label: 'x' })
    job.finish('done')
    job.update({ detail: 'late' })
    expect(reg.snapshot().recent[0].detail).toBeNull()
  })

  it('finish() merges meta into the recent entry', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'news', label: 'News digest', model: 'm' })
    job.finish('done', { tokens: 42, resultPath: '/tmp/out.md' })
    const r = reg.snapshot().recent[0]
    expect(r.status).toBe('done')
    expect(r.model).toBe('m')
    expect(r.tokens).toBe(42)
    expect(r.resultPath).toBe('/tmp/out.md')
    expect(r.error).toBeNull()
  })

  it('finish() carries an error message', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'k', label: 'x' })
    job.finish('error', { error: 'boom' })
    expect(reg.snapshot().recent[0].error).toBe('boom')
  })

  it('finish() falls back to the last update() detail', () => {
    const reg = new JobRegistry()
    const job = reg.register({ kind: 'benchmark', label: 'Benchmark batch' })
    job.update({ detail: '5/5 · analyzing' })
    job.finish('done')
    expect(reg.snapshot().recent[0].detail).toBe('5/5 · analyzing')
  })

  it('getResultPath returns the path for a recent job, null otherwise', () => {
    const reg = new JobRegistry()
    const active = reg.register({ kind: 'k', label: 'active' })
    expect(reg.getResultPath(active.id)).toBeNull() // active: no result yet
    const job = reg.register({ kind: 'news', label: 'News digest' })
    job.finish('done', { resultPath: '/tmp/x.md' })
    expect(reg.getResultPath(job.id)).toBe('/tmp/x.md')
    expect(reg.getResultPath('nope')).toBeNull()
  })
})

describe('trackJob meta', () => {
  it('maps the resolved value into finish meta', async () => {
    const reg = new JobRegistry()
    await trackJob(
      reg,
      { kind: 'news', label: 'News digest' },
      Promise.resolve({ filePath: '/tmp/n.md', outputTokens: 7 }),
      (r) => ({ tokens: r.outputTokens, resultPath: r.filePath }),
    )
    const r = reg.snapshot().recent[0]
    expect(r.tokens).toBe(7)
    expect(r.resultPath).toBe('/tmp/n.md')
  })

  it('sets error from the thrown message on rejection', async () => {
    const reg = new JobRegistry()
    await expect(
      trackJob(reg, { kind: 'k', label: 'x' }, Promise.reject(new Error('nope'))),
    ).rejects.toThrow('nope')
    expect(reg.snapshot().recent[0].error).toBe('nope')
  })
})
