import { revealInFinder } from '@main/services/files'
import { jobRegistry } from '@main/services/jobs/registry'
import { publicProcedure, router } from '@main/trpc/trpc'
import type { JobsSnapshot } from '@shared/jobs'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

export const jobsRouter = router({
  // Emit a fresh snapshot on subscribe, then on every registry change.
  list: publicProcedure.subscription(() =>
    observable<JobsSnapshot>((emit) => {
      emit.next(jobRegistry.snapshot())
      return jobRegistry.onChange(() => emit.next(jobRegistry.snapshot()))
    }),
  ),

  cancel: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => ({ ok: jobRegistry.cancel(input.jobId) })),

  // Reveal a recent job's output file in the OS file manager. Takes a jobId
  // (never a path) — the registry resolves the recorded resultPath, so the
  // renderer can't ask to reveal an arbitrary location.
  reveal: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const path = jobRegistry.getResultPath(input.jobId)
      if (path) revealInFinder(path)
      return { ok: Boolean(path) }
    }),
})
