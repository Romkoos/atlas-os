import { splitFrontmatter } from '@shared/skills'
import { describe, expect, it } from 'vitest'

describe('splitFrontmatter', () => {
  it('splits leading --- frontmatter from the body', () => {
    const raw = '---\nname: X\nallowed-tools:\n  - Read\n  - Write\n---\n\n# Body\ntext\n'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toContain('name: X')
    expect(body).toBe('# Body\ntext\n')
  })

  it('returns empty frontmatter and the whole string as body when no fence', () => {
    const raw = '# Just a body\nno frontmatter\n'
    expect(splitFrontmatter(raw)).toEqual({ frontmatter: '', body: raw })
  })

  it('handles CRLF line endings', () => {
    const raw = '---\r\nname: X\r\n---\r\nbody\r\n'
    const { frontmatter, body } = splitFrontmatter(raw)
    expect(frontmatter).toContain('name: X')
    expect(body).toBe('body\r\n')
  })
})
