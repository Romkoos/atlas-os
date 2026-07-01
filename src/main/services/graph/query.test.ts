import type { CodeGraph, CodeGraphEdge, CodeGraphNode } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { neighborsOf } from './query'

function n(id: string): CodeGraphNode {
  return {
    id,
    projectPath: '/r',
    kind: 'code',
    label: id,
    relPath: id,
    meta: null,
    community: 0,
    origin: 'indexer',
  }
}
function e(source: string, target: string): CodeGraphEdge {
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
// a - b - c - d
const g: CodeGraph = {
  nodes: [n('a'), n('b'), n('c'), n('d')],
  edges: [e('a', 'b'), e('b', 'c'), e('c', 'd')],
}

describe('neighborsOf', () => {
  it('depth 1 returns the node and direct neighbors', () => {
    const out = neighborsOf(g, 'b', 1)
    expect(out.nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
  it('depth 2 expands one more hop', () => {
    const out = neighborsOf(g, 'a', 2)
    expect(out.nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c'])
  })
  it('includes only edges among the returned nodes', () => {
    const out = neighborsOf(g, 'b', 1)
    expect(
      out.edges.every(
        (x) => ['a', 'b', 'c'].includes(x.source) && ['a', 'b', 'c'].includes(x.target),
      ),
    ).toBe(true)
  })
  it('returns empty graph for an unknown node', () => {
    expect(neighborsOf(g, 'zzz', 2)).toEqual({ nodes: [], edges: [] })
  })
})
