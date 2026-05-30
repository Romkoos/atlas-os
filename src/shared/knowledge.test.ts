import { describe, expect, it } from 'vitest'
import { type ArticleMeta, countInbound, resolveWikilink } from './knowledge'

const meta = (relPath: string, aliases: string[] = []): ArticleMeta => ({
  relPath,
  kind: relPath.startsWith('connections/') ? 'connection' : 'concept',
  title: relPath,
  tags: [],
  aliases,
  updated: null,
  inboundLinks: 0,
})

const ARTICLES: ArticleMeta[] = [
  meta('concepts/shorts-scroll.md', ['shorts']),
  meta('connections/player-mako.md'),
]

describe('resolveWikilink', () => {
  it('resolves a full path link', () => {
    expect(resolveWikilink('concepts/shorts-scroll', ARTICLES)).toBe('concepts/shorts-scroll.md')
  })
  it('resolves a bare slug by filename', () => {
    expect(resolveWikilink('player-mako', ARTICLES)).toBe('connections/player-mako.md')
  })
  it('resolves by alias', () => {
    expect(resolveWikilink('shorts', ARTICLES)).toBe('concepts/shorts-scroll.md')
  })
  it('returns null for a dangling link', () => {
    expect(resolveWikilink('concepts/nope', ARTICLES)).toBeNull()
  })
})

describe('countInbound', () => {
  it('counts other articles linking to the target, never itself', () => {
    const bodies = [
      { relPath: 'concepts/a.md', body: 'see [[concepts/shorts-scroll]] and [[shorts]]' },
      { relPath: 'concepts/shorts-scroll.md', body: 'links to [[concepts/shorts-scroll]] self' },
    ]
    expect(countInbound('concepts/shorts-scroll.md', bodies)).toBe(1)
  })
})
