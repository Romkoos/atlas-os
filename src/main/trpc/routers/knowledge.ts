import { computeGraph } from '@main/services/knowledge/graph'
import {
  compileAll,
  listArticles,
  listDaily,
  listProjects,
  readArticle,
  readDaily,
  readGraphSources,
  readIndex,
  runQuery,
  storeRoot,
} from '@main/services/knowledge/store'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import {
  articleDocSchema,
  articleMetaSchema,
  compileResultSchema,
  dailyEntrySchema,
  knowledgeGraphSchema,
  knowledgeProjectSchema,
} from '@shared/knowledge'
import { z } from 'zod'

const tracked = (): Set<string> => new Set(getSettings().trackedProjects ?? [])
const projectInput = z.object({
  project: z.string().regex(/^[^/\\.][^/\\]*$/, 'invalid project'),
})

export const knowledgeRouter = router({
  projects: publicProcedure
    .output(z.array(knowledgeProjectSchema))
    .query(() => listProjects(storeRoot(), tracked())),

  graph: publicProcedure.output(knowledgeGraphSchema).query(() => {
    const { articles, daily } = readGraphSources(storeRoot(), tracked())
    return computeGraph(articles, daily)
  }),

  index: publicProcedure
    .input(projectInput)
    .output(z.object({ raw: z.string() }))
    .query(({ input }) => ({ raw: readIndex(storeRoot(), input.project) })),

  list: publicProcedure
    .input(projectInput)
    .output(z.array(articleMetaSchema))
    .query(({ input }) => listArticles(storeRoot(), input.project)),

  article: publicProcedure
    .input(projectInput.extend({ relPath: z.string() }))
    .output(articleDocSchema)
    .query(({ input }) => readArticle(storeRoot(), input.project, input.relPath)),

  daily: publicProcedure
    .input(projectInput)
    .output(z.array(dailyEntrySchema))
    .query(({ input }) => listDaily(storeRoot(), input.project)),

  dailyArticle: publicProcedure
    .input(projectInput.extend({ relPath: z.string() }))
    .output(z.object({ raw: z.string() }))
    .query(({ input }) => ({ raw: readDaily(storeRoot(), input.project, input.relPath) })),

  query: publicProcedure
    .input(projectInput.extend({ q: z.string().min(1) }))
    .output(z.object({ answer: z.string() }))
    .mutation(async ({ input }) => ({
      answer: await runQuery(storeRoot(), input.project, input.q),
    })),

  compileAll: publicProcedure
    .output(z.array(compileResultSchema))
    .mutation(() => compileAll(storeRoot(), tracked())),
})
