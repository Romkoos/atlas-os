import { describe, expect, it } from 'vitest'
import { colorForKind, colorForNode, GRAPHIFY_COLOR } from './graph-colors'

describe('colorForNode', () => {
  it('colors graphify-origin nodes with the graphify color', () => {
    expect(colorForNode({ origin: 'graphify', kind: 'code' })).toBe(GRAPHIFY_COLOR)
  })
  it('colors structural nodes by kind', () => {
    expect(colorForNode({ origin: 'indexer', kind: 'code' })).toBe(colorForKind('code'))
  })
  it('uses a graphify color distinct from every structural kind color', () => {
    for (const k of ['code', 'doc', 'skill', 'knowledge', 'session'] as const) {
      expect(GRAPHIFY_COLOR).not.toBe(colorForKind(k))
    }
  })
})
