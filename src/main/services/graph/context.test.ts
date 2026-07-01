import type { CodeGraph } from '@shared/graph'
import { codeNodeId } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { getSubgraphContext } from './context'

const P = '/repo'
const A = codeNodeId(P, 'code', 'src/a.ts')
const B = codeNodeId(P, 'code', 'src/b.ts')
const K = codeNodeId(P, 'knowledge', 'concepts/x.md')
const graph: CodeGraph = {
  nodes: [
    {
      id: A,
      projectPath: P,
      kind: 'code',
      label: 'a.ts',
      relPath: 'src/a.ts',
      meta: null,
      community: 1,
      origin: 'indexer',
    },
    {
      id: B,
      projectPath: P,
      kind: 'code',
      label: 'b.ts',
      relPath: 'src/b.ts',
      meta: null,
      community: 1,
      origin: 'indexer',
    },
    {
      id: K,
      projectPath: P,
      kind: 'knowledge',
      label: 'Concept X',
      relPath: 'concepts/x.md',
      meta: null,
      community: 1,
      origin: 'indexer',
    },
  ],
  edges: [
    {
      id: `${A}|${B}|imports`,
      projectPath: P,
      source: A,
      target: B,
      kind: 'imports',
      inferred: false,
      origin: 'indexer',
      meta: null,
    },
    {
      id: `${A}|${K}|mentions_knowledge`,
      projectPath: P,
      source: A,
      target: K,
      kind: 'mentions_knowledge',
      inferred: true,
      origin: 'indexer',
      meta: null,
    },
  ],
}

describe('getSubgraphContext', () => {
  it('resolves a seed by id and lists neighbors grouped by edge kind', () => {
    const out = getSubgraphContext(graph, { seedNodeId: A, depth: 1 })
    expect(out).toContain('Project graph context')
    expect(out).toContain('src/a.ts')
    expect(out).toContain('b.ts')
    expect(out).toContain('Concept X')
  })
  it('resolves a seed by free-text query against labels/relPaths', () => {
    const out = getSubgraphContext(graph, { query: 'a.ts', depth: 1 })
    expect(out).toContain('src/a.ts')
  })
  it('returns empty string when no seed resolves', () => {
    expect(getSubgraphContext(graph, { query: 'nothing-matches-zzz' })).toBe('')
  })
  it('truncates to the budget', () => {
    const out = getSubgraphContext(graph, { seedNodeId: A, depth: 2, budget: 40 })
    expect(out.length).toBeLessThanOrEqual(40)
  })
})
