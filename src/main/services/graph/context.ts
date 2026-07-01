import type { CodeGraph, CodeGraphNode } from '@shared/graph'
import { neighborsOf } from './query'

export interface SubgraphContextOptions {
  seedNodeId?: string
  query?: string
  depth?: number
  budget?: number
}

function resolveSeed(graph: CodeGraph, opts: SubgraphContextOptions): CodeGraphNode | null {
  if (opts.seedNodeId) return graph.nodes.find((n) => n.id === opts.seedNodeId) ?? null
  const q = opts.query?.trim().toLowerCase()
  if (!q) return null
  return (
    graph.nodes.find(
      (n) => n.label.toLowerCase().includes(q) || (n.relPath ?? '').toLowerCase().includes(q),
    ) ?? null
  )
}

// Deterministic, token-bounded markdown excerpt of the subgraph around a seed.
// Groups neighbors by edge kind and direction. Returns '' when no seed resolves.
export function getSubgraphContext(graph: CodeGraph, opts: SubgraphContextOptions): string {
  const seed = resolveSeed(graph, opts)
  if (!seed) return ''
  const depth = opts.depth ?? 1
  const budget = opts.budget ?? 1200
  const sub = neighborsOf(graph, seed.id, depth)
  const byId = new Map(sub.nodes.map((n) => [n.id, n]))

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  for (const e of sub.edges) {
    if (e.source === seed.id) {
      const label = byId.get(e.target)?.label ?? e.target
      outgoing.set(e.kind, [...(outgoing.get(e.kind) ?? []), label])
    } else if (e.target === seed.id) {
      const label = byId.get(e.source)?.label ?? e.source
      incoming.set(e.kind, [...(incoming.get(e.kind) ?? []), label])
    }
  }

  const lines: string[] = ['## Project graph context']
  lines.push(`Seed: ${seed.relPath ?? seed.label} (${seed.kind}, cluster ${seed.community ?? '-'})`)
  for (const [kind, labels] of outgoing) lines.push(`${kind} → ${[...new Set(labels)].join(', ')}`)
  for (const [kind, labels] of incoming) lines.push(`${kind} ← ${[...new Set(labels)].join(', ')}`)

  const text = lines.join('\n')
  return text.length > budget ? text.slice(0, budget) : text
}
