import { jobRegistry } from '@main/services/jobs/registry'
import { appRouter } from '@main/trpc/router'
import { describe, expect, it, vi } from 'vitest'

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
