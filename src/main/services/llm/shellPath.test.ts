import { homedir } from 'node:os'
import { join } from 'node:path'
import { fallbackDirs, mergePath, parseShellPath } from '@main/services/llm/shellPath'
import { afterEach, describe, expect, it } from 'vitest'

describe('parseShellPath', () => {
  it('extracts the PATH from the sentinel line', () => {
    expect(parseShellPath('__ATLAS_PATH__:/a:/b:/c\n')).toBe('/a:/b:/c')
  })

  it('ignores interactive-rc noise before the sentinel', () => {
    const out = ['Welcome to zsh', 'some plugin banner', '__ATLAS_PATH__:/x/bin:/y/bin', ''].join(
      '\n',
    )
    expect(parseShellPath(out)).toBe('/x/bin:/y/bin')
  })

  it('returns null when the sentinel is absent', () => {
    expect(parseShellPath('no marker here\n')).toBeNull()
  })

  it('returns null when the sentinel has an empty PATH', () => {
    expect(parseShellPath('__ATLAS_PATH__:\n')).toBeNull()
  })
})

describe('mergePath', () => {
  const home = homedir()
  const local = join(home, '.local', 'bin')

  it('puts the real login-shell PATH first, then guarantees fallback dirs', () => {
    const merged = mergePath('/opt/x/bin:/usr/bin', '/usr/bin:/bin').split(':')
    expect(merged[0]).toBe('/opt/x/bin')
    expect(merged).toContain(local)
    expect(merged).toContain('/usr/bin')
    expect(merged).toContain('/bin')
  })

  it('dedupes while preserving first occurrence', () => {
    const merged = mergePath('/usr/bin:/usr/bin', '/usr/bin').split(':')
    expect(merged.filter((p) => p === '/usr/bin')).toHaveLength(1)
  })

  it('falls back to fallback dirs + current PATH when no real PATH resolved', () => {
    const merged = mergePath(null, '/usr/bin:/bin').split(':')
    expect(merged).toContain(local)
    expect(merged).toContain('/usr/bin')
  })

  it('always includes ~/.local/bin (where uv-installed graphify lives)', () => {
    expect(fallbackDirs()).toContain(local)
    expect(mergePath(null, undefined).split(':')).toContain(local)
  })
})

afterEach(() => {
  // no shared state to reset — pure functions
})
