import { ecosystemId, turnId } from '@main/services/productivity/ids'
import { describe, expect, it } from 'vitest'

describe('turnId', () => {
  it('is deterministic for the same session + index', () => {
    expect(turnId('s1', 0)).toBe(turnId('s1', 0))
  })

  it('differs across session or index', () => {
    expect(turnId('s1', 0)).not.toBe(turnId('s1', 1))
    expect(turnId('s1', 0)).not.toBe(turnId('s2', 0))
  })
})

describe('ecosystemId', () => {
  it('is deterministic for identical change content', () => {
    const a = ecosystemId('2026-05-23T10:00:00Z', 'config_changed', '/x/settings.json', null)
    const b = ecosystemId('2026-05-23T10:00:00Z', 'config_changed', '/x/settings.json', null)
    expect(a).toBe(b)
  })

  it('differs when any part differs', () => {
    const base = ecosystemId('2026-05-23T10:00:00Z', 'config_changed', '/x', null)
    expect(base).not.toBe(ecosystemId('2026-05-23T10:00:01Z', 'config_changed', '/x', null))
    expect(base).not.toBe(ecosystemId('2026-05-23T10:00:00Z', 'skill_edited', '/x', null))
  })
})
