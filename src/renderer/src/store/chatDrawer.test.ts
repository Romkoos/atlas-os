import { beforeEach, describe, expect, it } from 'vitest'
import { useChatDrawer } from './chatDrawer'

beforeEach(() => {
  useChatDrawer.setState({ open: false, sessions: [], activeSessionId: null })
})

describe('useChatDrawer.openSession', () => {
  it('adds a session, opens the drawer, and makes it active', () => {
    useChatDrawer.getState().openSession({ type: 'benchmark' })
    const s = useChatDrawer.getState()
    expect(s.open).toBe(true)
    expect(s.sessions).toEqual([{ id: 'benchmark', type: 'benchmark', title: 'discuss results' }])
    expect(s.activeSessionId).toBe('benchmark')
  })

  it('is idempotent per type: re-opening focuses the existing session (no duplicate)', () => {
    const { openSession, setActive } = useChatDrawer.getState()
    openSession({ type: 'benchmark' })
    openSession({ type: 'roadmap' })
    setActive('benchmark')
    useChatDrawer.getState().openSession({ type: 'roadmap' })
    const s = useChatDrawer.getState()
    expect(s.sessions).toHaveLength(2)
    expect(s.activeSessionId).toBe('roadmap')
    expect(s.open).toBe(true)
  })

  it('uses the default title per type and honors a custom title', () => {
    useChatDrawer.getState().openSession({ type: 'roadmap' })
    expect(useChatDrawer.getState().sessions[0].title).toBe('idea incubator')
    useChatDrawer.setState({ open: false, sessions: [], activeSessionId: null })
    useChatDrawer.getState().openSession({ type: 'benchmark', title: 'custom' })
    expect(useChatDrawer.getState().sessions[0].title).toBe('custom')
  })
})

describe('useChatDrawer.closeSession', () => {
  it('removes a session and closes the drawer when none remain', () => {
    const { openSession, closeSession } = useChatDrawer.getState()
    openSession({ type: 'benchmark' })
    closeSession('benchmark')
    const s = useChatDrawer.getState()
    expect(s.sessions).toEqual([])
    expect(s.activeSessionId).toBeNull()
    expect(s.open).toBe(false)
  })

  it('switches active to a remaining session and keeps the drawer open', () => {
    const { openSession, setActive, closeSession } = useChatDrawer.getState()
    openSession({ type: 'benchmark' })
    openSession({ type: 'roadmap' })
    setActive('roadmap')
    closeSession('roadmap')
    const s = useChatDrawer.getState()
    expect(s.sessions.map((x) => x.id)).toEqual(['benchmark'])
    expect(s.activeSessionId).toBe('benchmark')
    expect(s.open).toBe(true)
  })
})

describe('useChatDrawer misc actions', () => {
  it('toggle flips open and setOpen sets it explicitly', () => {
    useChatDrawer.getState().toggle()
    expect(useChatDrawer.getState().open).toBe(true)
    useChatDrawer.getState().setOpen(false)
    expect(useChatDrawer.getState().open).toBe(false)
  })
})
