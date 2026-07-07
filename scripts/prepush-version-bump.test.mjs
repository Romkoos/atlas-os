import { describe, expect, it } from 'vitest'
import {
  bumpPatch,
  decideBump,
  isValidSemver,
  parseVersion,
  setVersion,
  shouldSkipForRefs,
} from './prepush-version-bump.mjs'

describe('parseVersion', () => {
  it('reads the version field from package.json text', () => {
    expect(parseVersion('{"name":"x","version":"1.2.3"}')).toBe('1.2.3')
  })

  it('returns null when version is missing', () => {
    expect(parseVersion('{"name":"x"}')).toBeNull()
  })

  it('returns null when version is not a string', () => {
    expect(parseVersion('{"version":123}')).toBeNull()
  })

  it('returns null on malformed JSON (fail-open input)', () => {
    expect(parseVersion('not json')).toBeNull()
    expect(parseVersion('')).toBeNull()
  })
})

describe('isValidSemver', () => {
  it('accepts plain x.y.z', () => {
    expect(isValidSemver('0.1.0')).toBe(true)
    expect(isValidSemver('10.20.30')).toBe(true)
  })

  it('rejects anything that is not exactly three numeric segments', () => {
    expect(isValidSemver('1.2')).toBe(false)
    expect(isValidSemver('1.2.3.4')).toBe(false)
    expect(isValidSemver('1.2.3-beta.1')).toBe(false)
    expect(isValidSemver('1.2.x')).toBe(false)
    expect(isValidSemver('v1.2.3')).toBe(false)
    expect(isValidSemver('')).toBe(false)
    // @ts-expect-error runtime guard for non-strings
    expect(isValidSemver(null)).toBe(false)
  })
})

describe('bumpPatch', () => {
  it('increments the patch segment', () => {
    expect(bumpPatch('0.1.0')).toBe('0.1.1')
    expect(bumpPatch('1.2.9')).toBe('1.2.10')
    expect(bumpPatch('0.0.0')).toBe('0.0.1')
  })

  it('leaves major/minor untouched', () => {
    expect(bumpPatch('3.4.5')).toBe('3.4.6')
  })

  it('throws on an invalid version (so caller can fail-open)', () => {
    expect(() => bumpPatch('1.2')).toThrow()
    expect(() => bumpPatch('1.2.3-beta')).toThrow()
  })
})

describe('shouldSkipForRefs', () => {
  const zero = '0'.repeat(40)
  const sha = 'a'.repeat(40)

  it('does NOT skip a normal branch push', () => {
    const stdin = `refs/heads/feature ${sha} refs/heads/feature ${zero}\n`
    expect(shouldSkipForRefs(stdin)).toBe(false)
  })

  it('skips a branch delete (local sha all zeros)', () => {
    const stdin = `(delete) ${zero} refs/heads/feature ${sha}\n`
    expect(shouldSkipForRefs(stdin)).toBe(true)
  })

  it('skips a tag push', () => {
    const stdin = `refs/tags/v1 ${sha} refs/tags/v1 ${zero}\n`
    expect(shouldSkipForRefs(stdin)).toBe(true)
  })

  it('skips when stdin is empty', () => {
    expect(shouldSkipForRefs('')).toBe(true)
    expect(shouldSkipForRefs('   \n')).toBe(true)
  })

  it('does NOT skip when at least one actionable branch ref is present', () => {
    const stdin =
      `refs/tags/v1 ${sha} refs/tags/v1 ${zero}\n` +
      `refs/heads/feature ${sha} refs/heads/feature ${zero}\n`
    expect(shouldSkipForRefs(stdin)).toBe(false)
  })
})

describe('decideBump', () => {
  it('bumps when local matches the origin/main baseline', () => {
    expect(decideBump({ localVersion: '0.1.0', baselineVersion: '0.1.0' })).toEqual({
      action: 'bump',
      next: '0.1.1',
    })
  })

  it('skips (already bumped) when local differs from baseline', () => {
    expect(decideBump({ localVersion: '0.1.1', baselineVersion: '0.1.0' })).toMatchObject({
      action: 'skip',
      reason: 'already-bumped',
    })
  })

  it('skips (fail-open) when baseline is unavailable', () => {
    expect(decideBump({ localVersion: '0.1.0', baselineVersion: null })).toMatchObject({
      action: 'skip',
      reason: 'no-baseline',
    })
  })

  it('skips (fail-open) when the local version is malformed', () => {
    expect(decideBump({ localVersion: '0.1', baselineVersion: '0.1' })).toMatchObject({
      action: 'skip',
      reason: 'invalid-local',
    })
  })
})

describe('setVersion', () => {
  it('replaces the version while preserving surrounding text and trailing newline', () => {
    const input = '{\n  "name": "atlas-os",\n  "version": "0.1.0",\n  "type": "module"\n}\n'
    const output = setVersion(input, '0.1.1')
    expect(output).toBe(
      '{\n  "name": "atlas-os",\n  "version": "0.1.1",\n  "type": "module"\n}\n',
    )
  })

  it('only replaces the first version occurrence (the package version)', () => {
    const input = '{"version":"0.1.0","deps":{"x":{"version":"9.9.9"}}}'
    expect(setVersion(input, '0.1.1')).toBe(
      '{"version":"0.1.1","deps":{"x":{"version":"9.9.9"}}}',
    )
  })
})
