import { db } from '@main/db/client'
import { summarizeClusters } from '@main/services/graph/cluster'
import { getSubgraphContext } from '@main/services/graph/context'
import { type GraphifyDeepMapRun, runGraphifyDeepMap } from '@main/services/graph/graphifyRunner'
import { indexProject } from '@main/services/graph/indexer'
import { readNodePreview } from '@main/services/graph/preview'
import { neighborsOf } from '@main/services/graph/query'
import { listGraphProjects, loadGraph, saveStructuralGraph } from '@main/services/graph/store'
import { jobRegistry } from '@main/services/jobs/registry'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import { codeGraphSchema, graphClusterSchema, nodePreviewSchema } from '@shared/graph'
import type { GraphDeepMapEvent } from '@shared/ipc-events'
import { DEFAULT_MODEL_ID } from '@shared/models'
import { observable } from '@trpc/server/observable'
import { z } from 'zod'

const projectPathInput = z.object({ projectPath: z.string().min(1) })

// requestId → in-flight deep-map run, so cancelDeepMap can route to the right
// AbortController and a repeated subscribe for the same requestId is rejected.
const deepRuns = new Map<string, GraphifyDeepMapRun>()

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
    .query(() => listGraphProjects(db(), getSettings().trackedProjects ?? [])),

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

  nodePreview: publicProcedure
    .input(z.object({ nodeId: z.string().min(1) }))
    .output(nodePreviewSchema.nullable())
    .query(({ input }) => {
      // Resolve the node from the stored graph so kind/relPath/projectPath come
      // from our trusted index, never from client input.
      const scope = input.nodeId.split('::')[0] || '__all__'
      const node = loadGraph(db(), scope).nodes.find((n) => n.id === input.nodeId)
      return node ? readNodePreview(node) : null
    }),

  getProjectClusters: publicProcedure
    .input(z.object({ projectPath: z.string().min(1).optional() }))
    .output(z.array(graphClusterSchema))
    .query(({ input }) => summarizeClusters(loadGraph(db(), input.projectPath ?? '__all__'))),

  context: publicProcedure
    .input(
      z.object({
        projectPath: z.string().min(1),
        seedNodeId: z.string().optional(),
        query: z.string().optional(),
        depth: z.number().int().min(1).max(3).default(1),
        budget: z.number().int().min(100).max(8000).default(1200),
      }),
    )
    .output(z.object({ context: z.string() }))
    .query(({ input }) => ({
      context: getSubgraphContext(loadGraph(db(), input.projectPath), {
        seedNodeId: input.seedNodeId,
        query: input.query,
        depth: input.depth,
        budget: input.budget,
      }),
    })),

  build: publicProcedure
    .input(z.object({ requestId: z.string().min(1), projectPath: z.string().min(1) }))
    .subscription(({ input }) =>
      observable<GraphDeepMapEvent>((emit) => {
        if (deepRuns.has(input.requestId)) {
          emit.next({ type: 'error', message: 'A deep map is already running for this request.' })
          emit.complete()
          return
        }
        const model = getSettings().model ?? DEFAULT_MODEL_ID
        const job = jobRegistry.register({
          kind: 'graph.deepMap',
          label: `Build map: ${input.projectPath}`,
          model,
          abort: () => deepRuns.get(input.requestId)?.cancel(),
        })

        const run = runGraphifyDeepMap({
          projectPath: input.projectPath,
          model,
          emit: (event) => {
            if (event.type === 'done') job.finish('done')
            if (event.type === 'error' || event.type === 'aborted') job.finish('error')
            emit.next(event)
            if (event.type === 'done' || event.type === 'error' || event.type === 'aborted') {
              deepRuns.delete(input.requestId)
              emit.complete()
            }
          },
        })
        deepRuns.set(input.requestId, run)

        return () => {
          const r = deepRuns.get(input.requestId)
          if (r) {
            r.cancel()
            deepRuns.delete(input.requestId)
          }
          job.finish('error')
        }
      }),
    ),

  cancelDeepMap: publicProcedure
    .input(z.object({ requestId: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      const run = deepRuns.get(input.requestId)
      run?.cancel()
      deepRuns.delete(input.requestId)
      return { ok: Boolean(run) }
    }),
})
