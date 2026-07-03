import type { CodeGraph, CodeGraphNode } from '@shared/graph'

// The six toggleable sources. Structural node kinds plus the graphify layer.
export const SOURCE_KEYS = ['code', 'doc', 'session', 'knowledge', 'skill', 'graphify'] as const
export type SourceKey = (typeof SOURCE_KEYS)[number]

// A node's source is its layer: graphify-origin nodes are the 'graphify' source;
// every structural node's source is its kind (which is always one of the first
// five SOURCE_KEYS).
export function sourceOf(node: CodeGraphNode): SourceKey {
  return node.origin === 'graphify' ? 'graphify' : (node.kind as SourceKey)
}

// Keep nodes whose source is enabled, then keep edges whose both endpoints survive.
export function filterBySources(graph: CodeGraph, enabled: ReadonlySet<string>): CodeGraph {
  const nodes = graph.nodes.filter((node) => enabled.has(sourceOf(node)))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  return { nodes, edges }
}

// A community identifier scoped to its source layer: structural and graphify
// communities number independently, so the bare integer is ambiguous. Key on
// origin + community so cluster grouping/focus never conflates the two layers.
export function communityKey(node: Pick<CodeGraphNode, 'origin' | 'community'>): string {
  return `${node.origin}:${node.community ?? -1}`
}
