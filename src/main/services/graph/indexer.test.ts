import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkProject } from './indexer'

const dir = mkdtempSync(join(tmpdir(), 'atlas-walk-'))
mkdirSync(join(dir, 'src'), { recursive: true })
mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true })
writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1')
writeFileSync(join(dir, 'README.md'), '# hi')
writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), 'module.exports = 1')

describe('walkProject', () => {
  it('returns repo-relative files and skips ignored dirs', () => {
    const files = walkProject(dir)
    expect(files).toContain('src/a.ts')
    expect(files).toContain('README.md')
    expect(files.some((f) => f.includes('node_modules'))).toBe(false)
  })
})
