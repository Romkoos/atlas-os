import { diffInfraState, type InfraState } from '@main/services/productivity/infra'
import { describe, expect, it } from 'vitest'

const NOW = Date.parse('2026-05-25T10:00:00Z')

function state(over: Partial<InfraState> = {}): InfraState {
  return { plugins: {}, mcpActive: [], mcpDisabled: [], skills: {}, ...over }
}

// Map type→target for terse assertions on the emitted change set.
const pairs = (cs: { type: string; target: string | null }[]) =>
  cs.map((c) => `${c.type}:${c.target}`).sort()

describe('diffInfraState', () => {
  it('seeds silently on first run (prev null) — no flood of current state', () => {
    const curr = state({ plugins: { a: true }, mcpActive: ['x'], skills: { s: 1 } })
    expect(diffInfraState(null, curr, NOW)).toEqual([])
  })

  it('emits nothing when nothing changed', () => {
    const s = state({ plugins: { a: true }, mcpActive: ['x'], skills: { s: 1 } })
    expect(
      diffInfraState(s, state({ plugins: { a: true }, mcpActive: ['x'], skills: { s: 1 } }), NOW),
    ).toEqual([])
  })

  it('detects plugin added / removed', () => {
    const prev = state({ plugins: { a: true } })
    const curr = state({ plugins: { b: true } })
    expect(pairs(diffInfraState(prev, curr, NOW))).toEqual(['plugin_added:b', 'plugin_removed:a'])
  })

  it('detects plugin disabled and enabled via the enabled flag', () => {
    expect(
      pairs(diffInfraState(state({ plugins: { a: true } }), state({ plugins: { a: false } }), NOW)),
    ).toEqual(['plugin_disabled:a'])
    expect(
      pairs(diffInfraState(state({ plugins: { a: false } }), state({ plugins: { a: true } }), NOW)),
    ).toEqual(['plugin_enabled:a'])
  })

  it('detects mcp added / removed', () => {
    expect(pairs(diffInfraState(state(), state({ mcpActive: ['x'] }), NOW))).toEqual([
      'mcp_added:x',
    ])
    expect(pairs(diffInfraState(state({ mcpActive: ['x'] }), state(), NOW))).toEqual([
      'mcp_removed:x',
    ])
  })

  it('detects mcp disabled (active→disabled) and enabled (disabled→active)', () => {
    expect(
      pairs(diffInfraState(state({ mcpActive: ['x'] }), state({ mcpDisabled: ['x'] }), NOW)),
    ).toEqual(['mcp_disabled:x'])
    expect(
      pairs(diffInfraState(state({ mcpDisabled: ['x'] }), state({ mcpActive: ['x'] }), NOW)),
    ).toEqual(['mcp_enabled:x'])
  })

  it('detects skill added / removed', () => {
    expect(pairs(diffInfraState(state(), state({ skills: { s: 5 } }), NOW))).toEqual([
      'skill_added:s',
    ])
    expect(pairs(diffInfraState(state({ skills: { s: 5 } }), state(), NOW))).toEqual([
      'skill_removed:s',
    ])
  })

  it('detects skill edited only when its mtime increases', () => {
    expect(
      pairs(diffInfraState(state({ skills: { s: 5 } }), state({ skills: { s: 9 } }), NOW)),
    ).toEqual(['skill_edited:s'])
    expect(diffInfraState(state({ skills: { s: 5 } }), state({ skills: { s: 5 } }), NOW)).toEqual(
      [],
    )
  })

  it('dates skill add/edit by the skill mtime, other changes by now', () => {
    const added = diffInfraState(state(), state({ skills: { s: 1234 } }), NOW)
    expect(added[0].ts.getTime()).toBe(1234)
    const pluginAdded = diffInfraState(state(), state({ plugins: { a: true } }), NOW)
    expect(pluginAdded[0].ts.getTime()).toBe(NOW)
  })

  it('gives each change a stable deterministic id across identical diffs', () => {
    const a = diffInfraState(state({ plugins: { a: true } }), state({ plugins: { a: false } }), NOW)
    const b = diffInfraState(state({ plugins: { a: true } }), state({ plugins: { a: false } }), NOW)
    expect(a[0].id).toBe(b[0].id)
    expect(a[0].source).toBe('auto')
  })
})
