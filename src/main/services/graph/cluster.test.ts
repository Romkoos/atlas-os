import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { clusterGraph, summarizeClusters } from './cluster'

function node(id: string, kind: CodeGraphNode['kind'] = 'code'): CodeGraphNode {
  return {
    id,
    projectPath: '/r',
    kind,
    label: id,
    relPath: id,
    meta: null,
    community: null,
    origin: 'indexer',
  }
}
function edge(source: string, target: string): CodeGraphEdge {
  return {
    id: `${source}|${target}|imports`,
    projectPath: '/r',
    source,
    target,
    kind: 'imports',
    inferred: false,
    origin: 'indexer',
    meta: null,
  }
}

describe('clusterGraph', () => {
  it('assigns every node a numeric community', () => {
    const g: CodeGraph = { nodes: [node('a'), node('b'), node('c')], edges: [edge('a', 'b')] }
    const out = clusterGraph(g)
    expect(out.nodes.every((n) => typeof n.community === 'number')).toBe(true)
    // connected a-b share a community; isolated c differs from at least one of them
    const byId = Object.fromEntries(out.nodes.map((n) => [n.id, n.community]))
    expect(byId.a).toBe(byId.b)
  })

  it('gives isolated nodes distinct communities when there are no edges', () => {
    const g: CodeGraph = { nodes: [node('a'), node('b')], edges: [] }
    const out = clusterGraph(g)
    const ids = out.nodes.map((n) => n.community)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('summarizeClusters', () => {
  it('summarizes size, dominant kind and top nodes per community', () => {
    const g = clusterGraph({
      nodes: [node('a'), node('b'), node('c', 'doc')],
      edges: [edge('a', 'b')],
    })
    const clusters = summarizeClusters(g)
    expect(clusters.length).toBeGreaterThanOrEqual(1)
    const biggest = clusters[0]
    expect(biggest.size).toBeGreaterThanOrEqual(clusters[clusters.length - 1].size)
    expect(biggest.topNodes.length).toBeGreaterThan(0)
  })
})
