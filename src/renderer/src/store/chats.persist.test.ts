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
})
