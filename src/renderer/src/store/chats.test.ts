import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useChats } from './chats'

beforeEach(() => {
  useChats.setState({ sessions: [], activeSessionId: null })
})

describe('useChats.openSession', () => {
  it('adds a session and makes it active', () => {
    useChats.getState().openSession({ type: 'benchmark' })
    const s = useChats.getState()
    expect(s.sessions).toEqual([{ id: 'benchmark', type: 'benchmark', title: 'discuss results' }])
    expect(s.activeSessionId).toBe('benchmark')
  })

  it('is idempotent per type: re-opening focuses the existing session (no duplicate)', () => {
    const { openSession, setActive } = useChats.getState()
    openSession({ type: 'benchmark' })
    openSession({ type: 'roadmap' })
    setActive('benchmark')
    useChats.getState().openSession({ type: 'roadmap' })
    const s = useChats.getState()
    expect(s.sessions).toHaveLength(2)
    expect(s.activeSessionId).toBe('roadmap')
  })

  it('uses the default title per type and honors a custom title', () => {
    useChats.getState().openSession({ type: 'roadmap' })
    expect(useChats.getState().sessions[0].title).toBe('idea incubator')
    useChats.setState({ sessions: [], activeSessionId: null })
    useChats.getState().openSession({ type: 'benchmark', title: 'custom' })
    expect(useChats.getState().sessions[0].title).toBe('custom')
  })
})

describe('useChats.closeSession', () => {
  it('removes a session and clears the active id when none remain', () => {
    const { openSession, closeSession } = useChats.getState()
    openSession({ type: 'benchmark' })
    closeSession('benchmark')
    const s = useChats.getState()
    expect(s.sessions).toEqual([])
    expect(s.activeSessionId).toBeNull()
  })

  it('switches active to a remaining session', () => {
    const { openSession, setActive, closeSession } = useChats.getState()
    openSession({ type: 'benchmark' })
    openSession({ type: 'roadmap' })
    setActive('roadmap')
    closeSession('roadmap')
    const s = useChats.getState()
    expect(s.sessions.map((x) => x.id)).toEqual(['benchmark'])
    expect(s.activeSessionId).toBe('benchmark')
  })
})

describe('useChats skillImprover + title refresh', () => {
  it('opens a third session type with a custom title', () => {
    useChats.getState().openSession({ type: 'benchmark' })
    useChats.getState().openSession({ type: 'roadmap' })
    useChats.getState().openSession({ type: 'skillImprover', title: 'improver · my-skill' })
    const s = useChats.getState()
    expect(s.sessions.map((x) => x.id)).toEqual(['benchmark', 'roadmap', 'skillImprover'])
    expect(s.sessions.find((x) => x.type === 'skillImprover')?.title).toBe('improver · my-skill')
    expect(s.activeSessionId).toBe('skillImprover')
  })

  it('defaults the skillImprover title to "improver" when none is passed', () => {
    useChats.getState().openSession({ type: 'skillImprover' })
    expect(useChats.getState().sessions[0].title).toBe('improver')
  })

  it('refreshes the title when re-opening an existing session with a new title', () => {
    useChats.getState().openSession({ type: 'skillImprover', title: 'improver · a' })
    useChats.getState().openSession({ type: 'skillImprover', title: 'improver · b' })
    const s = useChats.getState()
    expect(s.sessions).toHaveLength(1)
    expect(s.sessions[0].title).toBe('improver · b')
  })

  it('keeps the existing title when re-opening without a title', () => {
    useChats.getState().openSession({ type: 'benchmark' })
    useChats.setState((st) => ({
      sessions: st.sessions.map((x) => ({ ...x, title: 'custom' })),
    }))
    useChats.getState().openSession({ type: 'benchmark' })
    expect(useChats.getState().sessions[0].title).toBe('custom')
  })
})

describe('useChats generalChat', () => {
  it('opens a generalChat tab with the default "chat" title', () => {
    useChats.getState().openSession({ type: 'generalChat' })
    const s = useChats.getState()
    expect(s.sessions.map((x) => x.id)).toEqual(['generalChat'])
    expect(s.sessions[0].title).toBe('chat')
    expect(s.activeSessionId).toBe('generalChat')
  })
})

describe('useChats worker', () => {
  it('opens a worker tab with the default "worker" title', () => {
    useChats.getState().openSession({ type: 'worker' })
    const s = useChats.getState()
    expect(s.sessions.some((x) => x.type === 'worker' && x.title === 'worker')).toBe(true)
    expect(s.activeSessionId).toBe('worker')
  })
})

describe('chats layout state', () => {
  it('defaults splitRatio to 0.5', () => {
    expect(useChats.getState().splitRatio).toBe(0.5)
  })
  it('clamps splitRatio into [0.2, 0.8]', () => {
    act(() => useChats.getState().setSplitRatio(0.95))
    expect(useChats.getState().splitRatio).toBe(0.8)
    act(() => useChats.getState().setSplitRatio(0.05))
    expect(useChats.getState().splitRatio).toBe(0.2)
  })
  it('remembers the canvas tab per type', () => {
    act(() => useChats.getState().setCanvasTab('worker', 'Docs'))
    expect(useChats.getState().canvasTabByType.worker).toBe('Docs')
  })
})
