import { agentRouter } from '@main/trpc/routers/agent'
import { healthRouter } from '@main/trpc/routers/health'
import { productivityRouter } from '@main/trpc/routers/productivity'
import { settingsRouter } from '@main/trpc/routers/settings'
import { skillsRouter } from '@main/trpc/routers/skills'
import { statsRouter } from '@main/trpc/routers/stats'
import { router } from '@main/trpc/trpc'

export const appRouter = router({
  health: healthRouter,
  settings: settingsRouter,
  agent: agentRouter,
  stats: statsRouter,
  skills: skillsRouter,
  productivity: productivityRouter,
})

export type AppRouter = typeof appRouter
