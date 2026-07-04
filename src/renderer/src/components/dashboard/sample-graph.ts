// The dashboard galaxy is decorative and always-animating, so it must stay
// cheap regardless of how large the real graph is. A full multi-project graph
// can be thousands of nodes — a 3D force sim + per-edge comets at that size
// janks hard and can crash the renderer's GPU process. So we render a bounded
// SAMPLE while the HUD reports the true totals (that's what "reflects the real
// node count" means — the headline number is honest; the poster is a subset).
//
// Sampling keeps the highest-degree nodes (the visual backbone — hubs and their
// clusters) so the decoration still reads as a rich structure, then keeps only
// edges whose endpoints both survive. Deterministic: no randomness, stable id
// ordering, so the picture doesn't reshuffle on every render.

export interface SampleNode {
  id: string
}

export interface SampleEdge {
  source: string
  target: string
}

export interface SampledGraph<N extends SampleNode, E extends SampleEdge> {
  nodes: N[]
  links: E[]
  totalNodes: number
  totalEdges: number
}

export function sampleGraph<N extends SampleNode, E extends SampleEdge>(
  nodes: N[],
  edges: E[],
  maxNodes: number,
): SampledGraph<N, E> {
  const totalNodes = nodes.length
  const totalEdges = edges.length

  if (nodes.length <= maxNodes) {
    const ids = new Set(nodes.map((n) => n.id))
    const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    return { nodes: [...nodes], links, totalNodes, totalEdges }
  }

  // Degree from the full edge list, so hub importance reflects the real graph.
  const degree = new Map<string, number>()
  for (const n of nodes) degree.set(n.id, 0)
  for (const e of edges) {
    if (degree.has(e.source)) degree.set(e.source, (degree.get(e.source) ?? 0) + 1)
    if (degree.has(e.target)) degree.set(e.target, (degree.get(e.target) ?? 0) + 1)
  }

  // Highest-degree first; ties broken by id for determinism.
  const kept = [...nodes]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || (a.id < b.id ? -1 : 1))
    .slice(0, maxNodes)

  const keptIds = new Set(kept.map((n) => n.id))
  const links = edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
  return { nodes: kept, links, totalNodes, totalEdges }
}
