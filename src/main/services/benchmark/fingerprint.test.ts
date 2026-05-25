// src/main/services/benchmark/fingerprint.test.ts
import { infraFingerprint } from '@main/services/benchmark/fingerprint'
import type { InfraState } from '@main/services/productivity/infra'
import { describe, expect, it } from 'vitest'

const base: InfraState = {
  plugins: { a: true, b: false },
  mcpActive: ['x', 'y'],
  mcpDisabled: ['z'],
  skills: { s1: 1000, s2: 2000 },
}

describe('infraFingerprint', () => {
  it('is order-independent', () => {
    const reordered: InfraState = {
      plugins: { b: false, a: true },
      mcpActive: ['y', 'x'],
      mcpDisabled: ['z'],
      skills: { s2: 2000, s1: 1000 },
    }
    expect(infraFingerprint(reordered)).toBe(infraFingerprint(base))
  })
  it('changes when a plugin is toggled', () => {
    expect(infraFingerprint({ ...base, plugins: { a: false, b: false } })).not.toBe(
      infraFingerprint(base),
    )
  })
  it('changes when an mcp server is added', () => {
    expect(infraFingerprint({ ...base, mcpActive: ['x', 'y', 'new'] })).not.toBe(
      infraFingerprint(base),
    )
  })
  it('changes when a skill mtime changes (edit)', () => {
    expect(infraFingerprint({ ...base, skills: { s1: 1000, s2: 9999 } })).not.toBe(
      infraFingerprint(base),
    )
  })
})
