import { db } from '@main/db/client'
import { summarizeClusters } from '@main/services/graph/cluster'
import { indexProject } from '@main/services/graph/indexer'
import { neighborsOf } from '@main/services/graph/query'
import { listGraphProjects, loadGraph, saveStructuralGraph } from '@main/services/graph/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import { codeGraphSchema, graphClusterSchema } from '@shared/graph'
import { z } from 'zod'

const projectPathInput = z.object({ projectPath: z.string().min(1) })

export const graphRouter = router({
  listProjects: publicProcedure
    .output(
      z.array(
        z.object({
          projectPath: z.string(),
          project: z.string(),
          hasGraph: z.boolean(),
          builtAt: z.number().nullable(),
        }),
      ),
    )
    .query(() => listGraphProjects(db())),

  buildGraph: publicProcedure
    .input(projectPathInput)
    .output(z.object({ nodes: z.number(), edges: z.number(), clusters: z.number() }))
    .mutation(({ input }) => {
      const graph = indexProject(db(), input.projectPath)
      saveStructuralGraph(db(), input.projectPath, graph)
      return {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        clusters: summarizeClusters(graph).length,
      }
    }),

  getGraph: publicProcedure
    .input(z.object({ scope: z.string().min(1) }))
    .output(codeGraphSchema)
    .query(({ input }) => loadGraph(db(), input.scope)),

  queryNeighbors: publicProcedure
    .input(z.object({ nodeId: z.string().min(1), depth: z.number().int().min(1).max(3) }))
    .output(codeGraphSchema)
    .query(({ input }) => {
      // The node id embeds its projectPath, or scope by '__all__' for cross-project.
      const scope = input.nodeId.split('::')[0] || '__all__'
      return neighborsOf(loadGraph(db(), scope), input.nodeId, input.depth)
    }),

  getProjectClusters: publicProcedure
    .input(z.object({ projectPath: z.string().min(1).optional() }))
    .output(z.array(graphClusterSchema))
    .query(({ input }) => summarizeClusters(loadGraph(db(), input.projectPath ?? '__all__'))),
})
