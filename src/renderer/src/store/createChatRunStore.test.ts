import { describe, expect, it } from 'vitest'
import { createChatRunStore } from './createChatRunStore'

describe('createChatRunStore', () => {
  it('start mints a sessionId and seeds the transcript', () => {
    const useStore = createChatRunStore('atlas-chat-run-test')
    useStore.getState().start('hello')
    const s = useStore.getState()
    expect(s.sessionId).toMatch(/[0-9a-f-]{36}/)
    expect(s.transcript).toEqual([{ kind: 'user', text: 'hello' }])
    expect(s.running).toBe(true)
    expect(s.status).toBe('running')
  })

  it('appendToken accumulates streaming and flushTurn commits it', () => {
    const useStore = createChatRunStore('atlas-chat-run-test2')
    useStore.getState().start('q')
    useStore.getState().appendToken('par')
    useStore.getState().appendToken('tial')
    expect(useStore.getState().streaming).toBe('partial')
    useStore.getState().flushTurn()
    expect(useStore.getState().streaming).toBe('')
    expect(useStore.getState().transcript.at(-1)).toEqual({ kind: 'assistant', text: 'partial' })
  })

  it('bumpSeq advances lastSeq monotonically', () => {
    const useStore = createChatRunStore('atlas-chat-run-test3')
    useStore.getState().bumpSeq(3)
    useStore.getState().bumpSeq(2) // out-of-order is ignored
    expect(useStore.getState().lastSeq).toBe(3)
  })
})
