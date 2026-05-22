import { agentRouter } from '@main/trpc/routers/agent'
import { healthRouter } from '@main/trpc/routers/health'
import { settingsRouter } from '@main/trpc/routers/settings'
import { statsRouter } from '@main/trpc/routers/stats'
import { router } from '@main/trpc/trpc'

export const appRouter = router({
  health: healthRouter,
  settings: settingsRouter,
  agent: agentRouter,
  stats: statsRouter,
})

export type AppRouter = typeof appRouter
