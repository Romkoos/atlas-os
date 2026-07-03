import type { CodeGraph } from '@shared/graph'
import { codeNodeId } from '@shared/graph'
import { describe, expect, it } from 'vitest'

import { mergeGraphifyGraph, parseGraphifyJson } from './graphifyRunner'

const P = '/repo'
// structural graph already has a.ts and b.ts as code nodes
const structural: CodeGraph = {
  nodes: [
    {
      id: codeNodeId(P, 'code', 'src/a.ts'),
      projectPath: P,
      kind: 'code',
      label: 'a.ts',
      relPath: 'src/a.ts',
      meta: null,
      community: 0,
      origin: 'indexer',
    },
    {
      id: codeNodeId(P, 'code', 'src/b.ts'),
      projectPath: P,
      kind: 'code',
      label: 'b.ts',
      relPath: 'src/b.ts',
      meta: null,
      community: 0,
      origin: 'indexer',
    },
  ],
  edges: [],
}

// Real graphify networkx node-link shape (nodes + links).
const raw = JSON.stringify({
  directed: true,
  nodes: [
    { id: 'src_a_ts', label: 'a.ts', source_file: 'src/a.ts', file_type: 'code', community: 3 },
    { id: 'src_b_ts', label: 'b.ts', source_file: 'src/b.ts', file_type: 'code', community: 3 },
    {
      id: 'concept_x',
      label: 'Concept X',
      source_file: 'notes/x.md',
      file_type: 'markdown',
      community: 4,
    },
  ],
  links: [
    { source: 'src_a_ts', target: 'src_b_ts', relation: 'calls', confidence: 'INFERRED' },
    { source: 'src_a_ts', target: 'concept_x', relation: 'documents', confidence: 'EXTRACTED' },
  ],
})

describe('parseGraphifyJson', () => {
  it('reads nodes and links defensively', () => {
    const gy = parseGraphifyJson(raw)
    expect(gy.nodes).toHaveLength(3)
    expect(gy.links).toHaveLength(2)
  })
  it('returns empty arrays on malformed input', () => {
    expect(parseGraphifyJson('not json')).toEqual({ nodes: [], links: [] })
  })
})

describe('mergeGraphifyGraph', () => {
  it('persists every graphify node as a graphify-origin node (does not collapse onto files)', () => {
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    // all three graphify nodes become graphify-origin nodes, ided by their graphify id
    expect(add.nodes).toHaveLength(3)
    expect(add.nodes.every((n) => n.origin === 'graphify')).toBe(true)
    const aGid = codeNodeId(P, 'code', 'src_a_ts')
    expect(add.nodes.find((n) => n.id === aGid)).toMatchObject({
      kind: 'code',
      label: 'a.ts',
      relPath: 'src/a.ts',
    })
    // the doc concept is kept too
    expect(add.nodes.find((n) => n.relPath === 'notes/x.md')).toMatchObject({
      origin: 'graphify',
      kind: 'doc',
    })
  })

  it('emits semantic edges between graphify nodes (not structural ids)', () => {
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const edge = add.edges.find(
      (e) =>
        e.kind === 'semantic' &&
        e.source === codeNodeId(P, 'code', 'src_a_ts') &&
        e.target === codeNodeId(P, 'code', 'src_b_ts'),
    )
    expect(edge).toMatchObject({ origin: 'graphify', inferred: true })
    expect(edge?.meta).toMatchObject({ audit: 'INFERRED', relation: 'calls' })
  })

  it('marks EXTRACTED semantic edges as not inferred', () => {
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const documents = add.edges.find((e) => e.meta?.relation === 'documents')
    expect(documents?.inferred).toBe(false)
  })

  it('bridges each graphify node to its structural file node via defined_in', () => {
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const bridge = add.edges.find(
      (e) =>
        e.kind === 'defined_in' &&
        e.source === codeNodeId(P, 'code', 'src_a_ts') &&
        e.target === codeNodeId(P, 'code', 'src/a.ts'),
    )
    expect(bridge).toMatchObject({ origin: 'graphify', inferred: false })
    // concept_x's source_file notes/x.md has no structural node → no bridge
    expect(add.edges.some((e) => e.kind === 'defined_in' && e.target.includes('notes/x.md'))).toBe(
      false,
    )
  })

  it('skips links referencing a graphify id absent from nodes (no fabricated node/edge)', () => {
    const dangling = JSON.stringify({
      nodes: [{ id: 'src_a_ts', label: 'a.ts', source_file: 'src/a.ts', file_type: 'code' }],
      links: [
        { source: 'src_a_ts', target: 'ghost_missing', relation: 'calls', confidence: 'INFERRED' },
      ],
    })
    const add = mergeGraphifyGraph(P, structural, parseGraphifyJson(dangling))
    expect(add.edges.some((e) => e.kind === 'semantic')).toBe(false)
    expect(add.nodes.some((n) => n.id.includes('ghost_missing'))).toBe(false)
  })
})
