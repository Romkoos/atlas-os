import { codeEdgeId, codeNodeId } from '@shared/graph'
import { describe, expect, it } from 'vitest'
import { type AssembleInput, assembleGraph } from './assemble'

const P = '/repo'

function baseInput(): AssembleInput {
  return {
    projectPath: P,
    codeFiles: ['src/a.ts', 'src/b.ts'],
    imports: [{ from: 'src/a.ts', to: 'src/b.ts' }],
    docs: ['README.md'],
    docLinks: [{ from: 'README.md', to: 'src/a.ts' }],
    skills: ['skills/foo/SKILL.md'],
    articles: [{ relPath: 'concepts/x.md', title: 'X', body: 'talks about a.ts here' }],
    sessions: [{ sessionId: 's1', label: '2026-06-30', filesTouched: ['src/b.ts'] }],
  }
}

describe('assembleGraph', () => {
  it('creates a node per code file / doc / skill / article / session', () => {
    const g = assembleGraph(baseInput())
    const kinds = g.nodes.reduce<Record<string, number>>((acc, n) => {
      acc[n.kind] = (acc[n.kind] ?? 0) + 1
      return acc
    }, {})
    expect(kinds).toEqual({ code: 2, doc: 1, skill: 1, knowledge: 1, session: 1 })
    expect(g.nodes.every((n) => n.origin === 'indexer' && n.community === null)).toBe(true)
  })

  it('creates an imports edge (not inferred)', () => {
    const g = assembleGraph(baseInput())
    const src = codeNodeId(P, 'code', 'src/a.ts')
    const tgt = codeNodeId(P, 'code', 'src/b.ts')
    const e = g.edges.find((x) => x.id === codeEdgeId(src, tgt, 'imports'))
    expect(e).toMatchObject({ source: src, target: tgt, kind: 'imports', inferred: false })
  })

  it('creates doc_link, session_touched, and inferred mentions_knowledge edges', () => {
    const g = assembleGraph(baseInput())
    const has = (kind: string) => g.edges.some((e) => e.kind === kind)
    expect(has('doc_link')).toBe(true)
    expect(has('session_touched')).toBe(true)
    const mk = g.edges.find((e) => e.kind === 'mentions_knowledge')
    expect(mk?.inferred).toBe(true)
    expect(mk?.target).toBe(codeNodeId(P, 'knowledge', 'concepts/x.md'))
  })

  it('drops edges whose endpoints are missing and self-loops', () => {
    const input = baseInput()
    input.imports.push({ from: 'src/a.ts', to: 'src/ghost.ts' }) // target not a code file
    input.imports.push({ from: 'src/a.ts', to: 'src/a.ts' }) // self-loop
    const g = assembleGraph(input)
    expect(g.edges.filter((e) => e.kind === 'imports')).toHaveLength(1)
  })
})
