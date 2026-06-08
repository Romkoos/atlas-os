import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readTrending, trendingFilePath } from '@main/services/trending'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// storeRoot() honours ATLAS_KB_STORE, so point it at a throwaway dir per test.
let store: string
const prevEnv = process.env.ATLAS_KB_STORE

beforeEach(() => {
  store = mkdtempSync(join(tmpdir(), 'atlas-trending-'))
  process.env.ATLAS_KB_STORE = store
})

afterEach(() => {
  if (prevEnv === undefined) delete process.env.ATLAS_KB_STORE
  else process.env.ATLAS_KB_STORE = prevEnv
  rmSync(store, { recursive: true, force: true })
})

describe('trendingFilePath', () => {
  it('resolves to news/github-trending.md under the store root', () => {
    expect(trendingFilePath()).toBe(join(store, 'news', 'github-trending.md'))
  })
})

describe('readTrending', () => {
  it('returns empty raw and null updatedAt when the file is absent', () => {
    expect(readTrending()).toEqual({ raw: '', updatedAt: null })
  })

  it('returns the file contents and an mtime when present', () => {
    mkdirSync(join(store, 'news'), { recursive: true })
    writeFileSync(trendingFilePath(), '# trends\n')

    const result = readTrending()
    expect(result.raw).toBe('# trends\n')
    expect(result.updatedAt).not.toBeNull()
    expect(() => new Date(result.updatedAt as string).toISOString()).not.toThrow()
  })
})
