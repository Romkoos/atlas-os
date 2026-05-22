import { healthRouter } from '@main/trpc/routers/health'
import { router } from '@main/trpc/trpc'

export const appRouter = router({
  health: healthRouter,
})

export type AppRouter = typeof appRouter
