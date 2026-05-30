import { describe, expect, it } from 'vitest'
import { assertInside, isTracked, parseFrontmatter } from './store'

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

describe('isTracked', () => {
  const projects = {
    'atlas-os': '/abs/atlas-os',
    'atlas-os-aa778f': '/home/atlas-knowledge/atlas-os',
  }
  it('shows all when allowlist empty', () => {
    expect(isTracked('atlas-os', projects, new Set())).toBe(true)
  })
  it('shows tracked basename', () => {
    expect(isTracked('atlas-os', projects, new Set(['/abs/atlas-os']))).toBe(true)
  })
  it('hides untracked basename', () => {
    expect(isTracked('atlas-os-aa778f', projects, new Set(['/abs/atlas-os']))).toBe(false)
  })
  it('hides basename missing from projects.json when allowlist non-empty', () => {
    expect(isTracked('ghost', projects, new Set(['/abs/atlas-os']))).toBe(false)
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

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { listArticles, listDaily, listProjects, readArticle, readIndex } from './store'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'kb-'))
  mkdirSync(join(root, '_engine'), { recursive: true })
  writeFileSync(join(root, '_engine', 'projects.json'), JSON.stringify({ proj: '/abs/proj' }))
  const k = join(root, 'proj', 'knowledge')
  mkdirSync(join(k, 'concepts'), { recursive: true })
  mkdirSync(join(k, 'connections'), { recursive: true })
  writeFileSync(join(k, 'index.md'), '# Index\n| link | summary |')
  writeFileSync(
    join(k, 'concepts', 'alpha.md'),
    '---\ntitle: Alpha\ntags: [x]\naliases: [a]\nupdated: 2026-05-01\n---\n# Alpha\nlinks [[connections/beta]]',
  )
  writeFileSync(
    join(k, 'connections', 'beta.md'),
    '---\ntitle: Beta\nupdated: 2026-05-02\n---\n# Beta\nbody',
  )
  mkdirSync(join(root, 'proj', 'daily'), { recursive: true })
  writeFileSync(join(root, 'proj', 'daily', '2026-05-30.md'), '# Daily')
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('listProjects', () => {
  it('lists tracked projects, skips _engine, counts articles + daily', () => {
    const projects = listProjects(root, new Set(['/abs/proj']))
    expect(projects.map((p) => p.name)).toEqual(['proj'])
    expect(projects[0].articleCount).toBe(2)
    expect(projects[0].dailyCount).toBe(1)
  })
  it('hides untracked projects', () => {
    expect(listProjects(root, new Set(['/abs/other']))).toEqual([])
  })
  it('skips a broken symlink in the store root without throwing', () => {
    symlinkSync(join(root, 'nonexistent-target'), join(root, 'broken'))
    const projects = listProjects(root, new Set())
    expect(projects.map((p) => p.name)).not.toContain('broken')
  })
})

describe('listArticles', () => {
  it('returns metadata with kind, tags, aliases, and inbound counts', () => {
    const arts = listArticles(root, 'proj')
    const beta = arts.find((a) => a.relPath === 'connections/beta.md')
    expect(beta?.kind).toBe('connection')
    expect(beta?.title).toBe('Beta')
    expect(beta?.inboundLinks).toBe(1)
    const alpha = arts.find((a) => a.relPath === 'concepts/alpha.md')
    expect(alpha?.tags).toEqual(['x'])
    expect(alpha?.aliases).toEqual(['a'])
  })
})

describe('readArticle / readIndex / listDaily', () => {
  it('reads an article doc', () => {
    expect(readArticle(root, 'proj', 'concepts/alpha.md').frontmatter.title).toBe('Alpha')
  })
  it('reads the raw index', () => {
    expect(readIndex(root, 'proj')).toContain('# Index')
  })
  it('lists daily entries newest-first', () => {
    expect(listDaily(root, 'proj')).toEqual([{ date: '2026-05-30', relPath: '2026-05-30.md' }])
  })
  it('rejects traversal in readArticle', () => {
    expect(() => readArticle(root, 'proj', '../../_engine/projects.json')).toThrow(/escapes/)
  })
  it('rejects project traversal in readArticle', () => {
    expect(() => readArticle(root, '../../etc', 'passwd.md')).toThrow(/invalid project|escapes/)
  })
  it('rejects project traversal in listArticles', () => {
    expect(() => listArticles(root, '../../etc')).toThrow(/invalid project|escapes/)
  })
})
