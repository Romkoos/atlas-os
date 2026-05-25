import { describe, expect, it } from 'vitest'
import { hoverReducer, initialHover } from './hoverSync'

describe('hoverReducer', () => {
  it('sets the active date', () => {
    expect(hoverReducer(initialHover, { type: 'set', date: '2026-05-18' })).toEqual({
      activeDate: '2026-05-18',
    })
  })

  it('clears the active date', () => {
    const active = { activeDate: '2026-05-18' }
    expect(hoverReducer(active, { type: 'clear' })).toEqual({ activeDate: null })
  })

  it('ignores an unknown action', () => {
    const state = { activeDate: '2026-05-18' }
    // @ts-expect-error unknown action type
    expect(hoverReducer(state, { type: 'noop' })).toBe(state)
  })
})
