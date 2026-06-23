import { describe, expect, it } from 'vitest'
import { buildGraph, type GraphArticleInput, type GraphDailyInput } from './graph'

const article = (over: Partial<GraphArticleInput>): GraphArticleInput => ({
  project: 'p',
  relPath: 'concepts/a.md',
  kind: 'concept',
  title: 'A',
  tags: [],
  aliases: [],
  updated: null,
  sources: [],
  body: '',
  ...over,
})

describe('buildGraph', () => {
  it('creates one node per article with id namespaced by project', () => {
    const g = buildGraph([article({ relPath: 'concepts/a.md', title: 'Alpha' })], [])
    expect(g.nodes).toHaveLength(1)
    expect(g.nodes[0]).toMatchObject({
      id: 'p::concepts/a',
      label: 'Alpha',
      type: 'concept',
      project: 'p',
    })
  })

  it('resolves a body wikilink to a link edge between articles', () => {
    const g = buildGraph(
      [
        article({ relPath: 'concepts/a.md', body: 'see [[concepts/b]]' }),
        article({ relPath: 'concepts/b.md', title: 'B' }),
      ],
      [],
    )
    expect(g.edges).toContainEqual({
      source: 'p::concepts/a',
      target: 'p::concepts/b',
      type: 'link',
    })
  })

  it('resolves a bare-slug wikilink via filename', () => {
    const g = buildGraph(
      [article({ relPath: 'concepts/a.md', body: '[[b]]' }), article({ relPath: 'concepts/b.md' })],
      [],
    )
    expect(g.edges).toContainEqual({
      source: 'p::concepts/a',
      target: 'p::concepts/b',
      type: 'link',
    })
  })

  it('creates a ghost node for an unresolved wikilink', () => {
    const g = buildGraph([article({ relPath: 'concepts/a.md', body: '[[concepts/missing]]' })], [])
    const ghost = g.nodes.find((n) => n.type === 'ghost')
    expect(ghost).toMatchObject({
      id: 'p::ghost::concepts/missing',
      label: 'concepts/missing',
      relPath: '',
    })
    expect(g.edges).toContainEqual({
      source: 'p::concepts/a',
      target: 'p::ghost::concepts/missing',
      type: 'link',
    })
  })

  it('links an article to a daily node via sources frontmatter as a source edge', () => {
    const daily: GraphDailyInput = { project: 'p', date: '2026-06-09', relPath: '2026-06-09.md' }
    const g = buildGraph(
      [article({ relPath: 'concepts/a.md', sources: ['daily/2026-06-09.md'] })],
      [daily],
    )
    expect(g.nodes).toContainEqual(
      expect.objectContaining({
        id: 'p::daily/2026-06-09',
        type: 'daily',
        relPath: '2026-06-09.md',
      }),
    )
    expect(g.edges).toContainEqual({
      source: 'p::concepts/a',
      target: 'p::daily/2026-06-09',
      type: 'source',
    })
  })

  it('treats a body wikilink to a daily log as a source edge', () => {
    const daily: GraphDailyInput = { project: 'p', date: '2026-06-09', relPath: '2026-06-09.md' }
    const g = buildGraph(
      [article({ relPath: 'concepts/a.md', body: 'from [[daily/2026-06-09.md]]' })],
      [daily],
    )
    expect(g.edges).toContainEqual({
      source: 'p::concepts/a',
      target: 'p::daily/2026-06-09',
      type: 'source',
    })
  })

  it('dedups duplicate edges and skips self-links', () => {
    const g = buildGraph(
      [
        article({
          relPath: 'concepts/a.md',
          body: '[[concepts/b]] and again [[concepts/b]] and [[concepts/a]]',
        }),
        article({ relPath: 'concepts/b.md' }),
      ],
      [],
    )
    const ab = g.edges.filter((e) => e.source === 'p::concepts/a' && e.target === 'p::concepts/b')
    expect(ab).toHaveLength(1)
    expect(g.edges.some((e) => e.source === e.target)).toBe(false)
  })

  it('computes inDegree as the count of incoming edges', () => {
    const g = buildGraph(
      [
        article({ relPath: 'concepts/a.md', body: '[[concepts/c]]' }),
        article({ relPath: 'concepts/b.md', body: '[[concepts/c]]' }),
        article({ relPath: 'concepts/c.md' }),
      ],
      [],
    )
    expect(g.nodes.find((n) => n.id === 'p::concepts/c')?.inDegree).toBe(2)
  })

  it('keeps same-named concepts in different projects as distinct nodes', () => {
    const g = buildGraph(
      [
        article({ project: 'p1', relPath: 'concepts/x.md' }),
        article({ project: 'p2', relPath: 'concepts/x.md' }),
      ],
      [],
    )
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['p1::concepts/x', 'p2::concepts/x'])
  })
})
