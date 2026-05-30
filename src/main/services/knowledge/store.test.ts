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
