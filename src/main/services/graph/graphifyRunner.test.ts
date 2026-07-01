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
  it('maps graphify nodes to existing code nodes by relPath and emits semantic edges', () => {
    const additions = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const edge = additions.edges.find(
      (e) =>
        e.source === codeNodeId(P, 'code', 'src/a.ts') &&
        e.target === codeNodeId(P, 'code', 'src/b.ts'),
    )
    expect(edge).toMatchObject({ kind: 'semantic', origin: 'graphify', inferred: true })
    expect(edge?.meta).toMatchObject({ audit: 'INFERRED', relation: 'calls' })
  })

  it('creates a graphify-origin node only for files absent from the structural graph', () => {
    const additions = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const created = additions.nodes.find((n) => n.relPath === 'notes/x.md')
    expect(created).toMatchObject({ origin: 'graphify', kind: 'doc' })
    // a.ts and b.ts already exist structurally → not re-created
    expect(additions.nodes.some((n) => n.relPath === 'src/a.ts')).toBe(false)
  })

  it('marks EXTRACTED edges as not inferred', () => {
    const additions = mergeGraphifyGraph(P, structural, parseGraphifyJson(raw))
    const documents = additions.edges.find((e) => e.meta?.relation === 'documents')
    expect(documents?.inferred).toBe(false)
  })
})
