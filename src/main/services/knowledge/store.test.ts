import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertInside,
  parseFrontmatter,
  projectNameForPath,
  readAllArticles,
  readArticle,
} from './store'

describe('parseFrontmatter', () => {
  it('splits YAML frontmatter from body', () => {
    const raw = '---\ntitle: Foo\ntags: [a, b]\n---\n# Foo\nbody text'
    const doc = parseFrontmatter(raw)
    expect(doc.frontmatter.title).toBe('Foo')
    expect(doc.frontmatter.tags).toEqual(['a', 'b'])
    expect(doc.body).toBe('# Foo\nbody text')
  })
  it('returns empty frontmatter when none present', () => {
    const doc = parseFrontmatter('# No frontmatter\ntext')
    expect(doc.frontmatter).toEqual({})
    expect(doc.body).toBe('# No frontmatter\ntext')
  })
  it('degrades to empty frontmatter on malformed YAML', () => {
    const doc = parseFrontmatter('---\ntitle: : :\n  bad\n---\nbody')
    expect(doc.frontmatter).toEqual({})
    expect(doc.body).toBe('body')
  })
  it('degrades array frontmatter to empty object', () => {
    const doc = parseFrontmatter('---\n- a\n- b\n---\nbody')
    expect(doc.frontmatter).toEqual({})
    expect(doc.body).toBe('body')
  })
})

describe('assertInside', () => {
  it('returns the resolved path when inside root', () => {
    expect(assertInside('/root', 'concepts/x.md')).toBe('/root/concepts/x.md')
  })
  it('throws on traversal', () => {
    expect(() => assertInside('/root', '../escape')).toThrow(/escapes/)
  })
  it('throws on absolute escape', () => {
    expect(() => assertInside('/root', '/etc/passwd')).toThrow(/escapes/)
  })
})

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-'))
  mkdirSync(join(root, '_engine'), { recursive: true })
  writeFileSync(join(root, '_engine', 'projects.json'), JSON.stringify({ proj: '/abs/proj' }))
  const k = join(root, 'proj', 'knowledge')
  mkdirSync(join(k, 'concepts'), { recursive: true })
  mkdirSync(join(k, 'connections'), { recursive: true })
  writeFileSync(
    join(k, 'concepts', 'alpha.md'),
    '---\ntitle: Alpha\ntags: [x]\naliases: [a]\nupdated: 2026-05-01\n---\n# Alpha\nlinks [[connections/beta]]',
  )
  writeFileSync(
    join(k, 'connections', 'beta.md'),
    '---\ntitle: Beta\nupdated: 2026-05-02\n---\n# Beta\nbody',
  )
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('projectNameForPath', () => {
  it('maps a registered abspath to its project name', () => {
    expect(projectNameForPath(root, '/abs/proj')).toBe('proj')
  })
  it('returns null for an unregistered abspath', () => {
    expect(projectNameForPath(root, '/abs/other')).toBeNull()
  })
  it('returns null when projects.json is absent', () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'kb-empty-'))
    try {
      expect(projectNameForPath(emptyRoot, '/abs/proj')).toBeNull()
    } finally {
      rmSync(emptyRoot, { recursive: true, force: true })
    }
  })
})

describe('readAllArticles', () => {
  it('reads every article across kind dirs with parsed frontmatter', () => {
    const all = readAllArticles(root, 'proj')
    expect(all.map((a) => a.relPath).sort()).toEqual(['concepts/alpha.md', 'connections/beta.md'])
    const beta = all.find((a) => a.relPath === 'connections/beta.md')
    expect(beta?.kind).toBe('connection')
    expect(beta?.doc.frontmatter.title).toBe('Beta')
  })
})

describe('readArticle', () => {
  it('reads an article doc', () => {
    expect(readArticle(root, 'proj', 'concepts/alpha.md').frontmatter.title).toBe('Alpha')
  })
  it('rejects traversal in readArticle', () => {
    expect(() => readArticle(root, 'proj', '../../_engine/projects.json')).toThrow(/escapes/)
  })
  it('rejects project traversal in readArticle', () => {
    expect(() => readArticle(root, '../../etc', 'passwd.md')).toThrow(/invalid project|escapes/)
  })
})
