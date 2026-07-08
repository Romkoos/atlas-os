import { describe, expect, it } from 'vitest'
import { type ChatsState, mergePersistedChats } from './chats'

const base: ChatsState = {
  open: false,
  sessions: [],
  activeSessionId: null,
  openSession: () => {},
  closeSession: () => {},
  setActive: () => {},
  setOpen: () => {},
  splitRatio: 0.5,
  setSplitRatio: () => {},
  canvasTabByType: {},
  setCanvasTab: () => {},
}

describe('mergePersistedChats', () => {
  it('keeps valid sessions and live actions', () => {
    const merged = mergePersistedChats(
      {
        open: true,
        activeSessionId: 'roadmap',
        sessions: [{ id: 'roadmap', type: 'roadmap', title: 'x' }],
      },
      base,
    )
    expect(merged.open).toBe(true)
    expect(merged.sessions).toHaveLength(1)
    expect(typeof merged.openSession).toBe('function')
  })

  it('drops sessions with unknown types', () => {
    const merged = mergePersistedChats(
      { sessions: [{ id: 'x', type: 'bogus', title: 'x' }] } as unknown,
      base,
    )
    expect(merged.sessions).toEqual([])
  })

  it('forces open=false when no sessions survive', () => {
    const merged = mergePersistedChats({ open: true, sessions: [] }, base)
    expect(merged.open).toBe(false)
    expect(merged.activeSessionId).toBeNull()
  })

  it('falls back splitRatio to 0.5 when persisted value is non-numeric', () => {
    const merged = mergePersistedChats({ splitRatio: 'nope' }, base)
    expect(merged.splitRatio).toBe(0.5)
  })

  it('falls back splitRatio to 0.5 when persisted value is NaN', () => {
    const merged = mergePersistedChats({ splitRatio: Number.NaN }, base)
    expect(merged.splitRatio).toBe(0.5)
  })

  it('clamps an out-of-range persisted splitRatio above the max', () => {
    const merged = mergePersistedChats({ splitRatio: 1.5 }, base)
    expect(merged.splitRatio).toBe(0.8)
  })

  it('clamps an out-of-range persisted splitRatio below the min', () => {
    const merged = mergePersistedChats({ splitRatio: 0.01 }, base)
    expect(merged.splitRatio).toBe(0.2)
  })

  it('carries a valid in-range persisted splitRatio through unchanged', () => {
    const merged = mergePersistedChats({ splitRatio: 0.7 }, base)
    expect(merged.splitRatio).toBe(0.7)
  })

  it('falls back canvasTabByType to {} when persisted value is an array', () => {
    const merged = mergePersistedChats({ canvasTabByType: ['worker', 'Docs'] }, base)
    expect(merged.canvasTabByType).toEqual({})
  })

  it('falls back canvasTabByType to {} when persisted value is a non-object', () => {
    const merged = mergePersistedChats({ canvasTabByType: 'worker' }, base)
    expect(merged.canvasTabByType).toEqual({})
    const mergedNumber = mergePersistedChats({ canvasTabByType: 42 }, base)
    expect(mergedNumber.canvasTabByType).toEqual({})
  })

  it('carries a valid persisted canvasTabByType object through unchanged', () => {
    const merged = mergePersistedChats({ canvasTabByType: { worker: 'Docs' } }, base)
    expect(merged.canvasTabByType).toEqual({ worker: 'Docs' })
  })
})
