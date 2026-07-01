import type { CodeGraph } from '@shared/graph'

// Induced subgraph within `depth` undirected hops of `nodeId` (inclusive).
export function neighborsOf(graph: CodeGraph, nodeId: string, depth: number): CodeGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  if (!byId.has(nodeId)) return { nodes: [], edges: [] }

  const adj = new Map<string, Set<string>>()
  for (const e of graph.edges) {
    if (!adj.has(e.source)) adj.set(e.source, new Set())
    if (!adj.has(e.target)) adj.set(e.target, new Set())
    adj.get(e.source)?.add(e.target)
    adj.get(e.target)?.add(e.source)
  }

  const keep = new Set<string>([nodeId])
  let frontier = [nodeId]
  for (let d = 0; d < Math.max(0, depth); d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!keep.has(nb)) {
          keep.add(nb)
          next.push(nb)
        }
      }
    }
    frontier = next
    if (frontier.length === 0) break
  }

  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  }
}
