import type { CodeGraph } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { communityKey, filterBySources, sourceOf } from './source-filter'

const n = (
  id: string,
  kind: CodeGraph['nodes'][number]['kind'],
  origin: 'indexer' | 'graphify',
) => ({
  id,
  projectPath: 'p',
  kind,
  label: id,
  relPath: null,
  meta: null,
  community: 0,
  origin,
})

const graph: CodeGraph = {
  nodes: [
    n('code1', 'code', 'indexer'),
    n('sess1', 'session', 'indexer'),
    n('gfy1', 'code', 'graphify'),
  ],
  edges: [
    {
      id: 'e1',
      projectPath: 'p',
      source: 'code1',
      target: 'sess1',
      kind: 'session_touched',
      inferred: false,
      origin: 'indexer',
      meta: null,
    },
    {
      id: 'e2',
      projectPath: 'p',
      source: 'gfy1',
      target: 'code1',
      kind: 'defined_in',
      inferred: false,
      origin: 'graphify',
      meta: null,
    },
  ],
}

describe('sourceOf', () => {
  it('maps graphify-origin nodes to graphify, structural nodes to their kind', () => {
    expect(sourceOf(graph.nodes[0])).toBe('code')
    expect(sourceOf(graph.nodes[1])).toBe('session')
    expect(sourceOf(graph.nodes[2])).toBe('graphify')
  })
})

describe('filterBySources', () => {
  it('keeps only enabled sources and edges whose both endpoints survive', () => {
    const out = filterBySources(graph, new Set(['code', 'graphify']))
    expect(out.nodes.map((x) => x.id).sort()).toEqual(['code1', 'gfy1'])
    // session node dropped → its edge dropped; the defined_in edge survives
    expect(out.edges.map((e) => e.id)).toEqual(['e2'])
  })

  it('returns the whole graph when all sources are enabled', () => {
    const out = filterBySources(graph, new Set(['code', 'session', 'graphify']))
    expect(out.nodes).toHaveLength(3)
    expect(out.edges).toHaveLength(2)
  })
})

describe('communityKey', () => {
  it('gives different keys for the same community number across different origins', () => {
    const structural = { origin: 'indexer' as const, community: 3 }
    const graphify = { origin: 'graphify' as const, community: 3 }
    expect(communityKey(structural)).not.toBe(communityKey(graphify))
  })

  it('gives the same key for the same origin and community', () => {
    const a = { origin: 'indexer' as const, community: 3 }
    const b = { origin: 'indexer' as const, community: 3 }
    expect(communityKey(a)).toBe(communityKey(b))
  })

  it('keys a null community as <origin>:-1', () => {
    expect(communityKey({ origin: 'indexer' as const, community: null })).toBe('indexer:-1')
  })
})
