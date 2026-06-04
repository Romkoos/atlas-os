import { describe, expect, it } from 'vitest'
import { formatVersion } from './plugins'

describe('formatVersion', () => {
  it('renders a semver version with a v prefix', () => {
    expect(formatVersion('1.1.1', null)).toBe('v1.1.1')
    expect(formatVersion('5.1.0', 'abcdef0')).toBe('v5.1.0')
  })

  it('does not double the v prefix', () => {
    expect(formatVersion('v2.0', null)).toBe('v2.0')
  })

  it('renders a short commit for version="unknown" when a sha is known', () => {
    expect(formatVersion('unknown', '06b6d5b96fe846f05')).toBe('#06b6d5b')
  })

  it('renders a short commit when the version itself is a bare sha', () => {
    expect(formatVersion('84cc3c14fa1e', null)).toBe('#84cc3c1')
  })

  it('falls back to "unversioned" when nothing usable is available', () => {
    expect(formatVersion('unknown', null)).toBe('unversioned')
    expect(formatVersion('', null)).toBe('unversioned')
  })
})
