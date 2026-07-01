import { agentRouter } from '@main/trpc/routers/agent'
import { benchmarkRouter } from '@main/trpc/routers/benchmark'
import { benchmarkChatRouter } from '@main/trpc/routers/benchmarkChat'
import { graphRouter } from '@main/trpc/routers/graph'
import { healthRouter } from '@main/trpc/routers/health'
import { jobsRouter } from '@main/trpc/routers/jobs'
import { knowledgeRouter } from '@main/trpc/routers/knowledge'
import { newsRouter } from '@main/trpc/routers/news'
import { pluginsRouter } from '@main/trpc/routers/plugins'
import { productivityRouter } from '@main/trpc/routers/productivity'
import { roadmapRouter } from '@main/trpc/routers/roadmap'
import { roadmapChatRouter } from '@main/trpc/routers/roadmapChat'
import { settingsRouter } from '@main/trpc/routers/settings'
import { skillImproverRouter } from '@main/trpc/routers/skillImprover'
import { skillsRouter } from '@main/trpc/routers/skills'
import { statsRouter } from '@main/trpc/routers/stats'
import { trendingRouter } from '@main/trpc/routers/trending'
import { router } from '@main/trpc/trpc'

export const appRouter = router({
  health: healthRouter,
  jobs: jobsRouter,
  settings: settingsRouter,
  agent: agentRouter,
  stats: statsRouter,
  skills: skillsRouter,
  skillImprover: skillImproverRouter,
  productivity: productivityRouter,
  benchmark: benchmarkRouter,
  benchmarkChat: benchmarkChatRouter,
  knowledge: knowledgeRouter,
  graph: graphRouter,
  news: newsRouter,
  trending: trendingRouter,
  plugins: pluginsRouter,
  roadmap: roadmapRouter,
  roadmapChat: roadmapChatRouter,
})

export type AppRouter = typeof appRouter
