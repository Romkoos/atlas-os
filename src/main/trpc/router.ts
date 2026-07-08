import { generalChatRouter } from '@main/trpc/routers/generalChat'
import { graphRouter } from '@main/trpc/routers/graph'
import { healthRouter } from '@main/trpc/routers/health'
import { jobsRouter } from '@main/trpc/routers/jobs'
import { knowledgeRouter } from '@main/trpc/routers/knowledge'
import { newsRouter } from '@main/trpc/routers/news'
import { pluginsRouter } from '@main/trpc/routers/plugins'
import { productivityRouter } from '@main/trpc/routers/productivity'
import { rebuildRouter } from '@main/trpc/routers/rebuild'
import { roadmapRouter } from '@main/trpc/routers/roadmap'
import { roadmapChatRouter } from '@main/trpc/routers/roadmapChat'
import { settingsRouter } from '@main/trpc/routers/settings'
import { signalsRouter } from '@main/trpc/routers/signals'
import { skillImproverRouter } from '@main/trpc/routers/skillImprover'
import { skillsRouter } from '@main/trpc/routers/skills'
import { subscriptionUsageRouter } from '@main/trpc/routers/subscriptionUsage'
import { timelineRouter } from '@main/trpc/routers/timeline'
import { trendingRouter } from '@main/trpc/routers/trending'
import { workerChatRouter } from '@main/trpc/routers/workerChat'
import { router } from '@main/trpc/trpc'

export const appRouter = router({
  health: healthRouter,
  jobs: jobsRouter,
  settings: settingsRouter,
  rebuild: rebuildRouter,
  skills: skillsRouter,
  skillImprover: skillImproverRouter,
  productivity: productivityRouter,
  knowledge: knowledgeRouter,
  graph: graphRouter,
  news: newsRouter,
  trending: trendingRouter,
  signals: signalsRouter,
  plugins: pluginsRouter,
  roadmap: roadmapRouter,
  roadmapChat: roadmapChatRouter,
  generalChat: generalChatRouter,
  workerChat: workerChatRouter,
  subscriptionUsage: subscriptionUsageRouter,
  timeline: timelineRouter,
})

export type AppRouter = typeof appRouter
