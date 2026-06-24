import { revealInFinder } from '@main/services/files'
import { jobRegistry } from '@main/services/jobs/registry'
import { appRouter } from '@main/trpc/router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/files', () => ({ revealInFinder: vi.fn() }))

describe('jobs router', () => {
  it('cancel routes to the registry and reports outcome', async () => {
    const caller = appRouter.createCaller({})
    const abort = vi.fn()
    const job = jobRegistry.register({ kind: 'news', label: 'News digest', abort })
    expect(await caller.jobs.cancel({ jobId: job.id })).toEqual({ ok: true })
    expect(abort).toHaveBeenCalledOnce()
    expect(await caller.jobs.cancel({ jobId: 'missing' })).toEqual({ ok: false })
    job.finish('error')
  })
})

describe('jobs.reveal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reveals a recent job output path and reports ok', async () => {
    const caller = appRouter.createCaller({})
    const job = jobRegistry.register({ kind: 'news', label: 'News digest' })
    job.finish('done', { resultPath: '/tmp/out.md' })
    expect(await caller.jobs.reveal({ jobId: job.id })).toEqual({ ok: true })
    expect(revealInFinder).toHaveBeenCalledWith('/tmp/out.md')
  })

  it('is a no-op for an unknown job', async () => {
    const caller = appRouter.createCaller({})
    expect(await caller.jobs.reveal({ jobId: 'missing' })).toEqual({ ok: false })
    expect(revealInFinder).not.toHaveBeenCalled()
  })
})
