import type { CodeGraph, CodeNodeKind, GraphCluster } from '@shared/graph'
import Graph from 'graphology'
import louvain from 'graphology-communities-louvain'

// Fill `community` on every node via Louvain (undirected). Mirrors
// knowledge/graph.ts assignCommunities: no edges → each node its own community.
export function clusterGraph(graph: CodeGraph): CodeGraph {
  const g = new Graph({ type: 'undirected', multi: false })
  for (const n of graph.nodes) g.addNode(n.id)
  for (const e of graph.edges) {
    if (e.source === e.target || g.hasEdge(e.source, e.target)) continue
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue
    g.addEdge(e.source, e.target)
  }

  let communities: Record<string, number>
  if (g.size === 0) {
    communities = {}
    graph.nodes.forEach((n, i) => {
      communities[n.id] = i
    })
  } else {
    communities = louvain(g)
  }

  return {
    nodes: graph.nodes.map((n) => ({ ...n, community: communities[n.id] ?? 0 })),
    edges: graph.edges,
  }
}

export function summarizeClusters(graph: CodeGraph): GraphCluster[] {
  const byCommunity = new Map<number, CodeGraph['nodes']>()
  for (const n of graph.nodes) {
    const c = n.community ?? 0
    const list = byCommunity.get(c) ?? []
    list.push(n)
    byCommunity.set(c, list)
  }
  const clusters: GraphCluster[] = []
  for (const [community, members] of byCommunity) {
    const kindCounts = new Map<CodeNodeKind, number>()
    for (const m of members) kindCounts.set(m.kind, (kindCounts.get(m.kind) ?? 0) + 1)
    let dominantKind: CodeNodeKind = members[0].kind
    let best = 0
    for (const [k, count] of kindCounts) {
      if (count > best) {
        best = count
        dominantKind = k
      }
    }
    const topNodes = [...members]
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 5)
      .map((m) => ({ id: m.id, label: m.label }))
    clusters.push({ community, size: members.length, dominantKind, topNodes })
  }
  return clusters.sort((a, b) => b.size - a.size)
}
