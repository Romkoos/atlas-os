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

  describe('tool entries', () => {
    it('pushTool adds a running tool entry and resolveTool completes it', () => {
      const useRun = createChatRunStore('test-tool-1')
      useRun.getState().start('hi')
      useRun.getState().pushTool('t1', 'Read: store.ts')
      let tool = useRun.getState().transcript.find((e) => e.kind === 'tool')
      expect(tool).toMatchObject({
        kind: 'tool',
        id: 't1',
        status: 'running',
        text: 'Read: store.ts',
      })

      useRun.getState().resolveTool('t1', 'file contents', false)
      tool = useRun.getState().transcript.find((e) => e.kind === 'tool')
      expect(tool).toMatchObject({ id: 't1', status: 'done', resultText: 'file contents' })
    })

    it('resolveTool with isError marks the entry as error', () => {
      const useRun = createChatRunStore('test-tool-2')
      useRun.getState().start('hi')
      useRun.getState().pushTool('t1', 'Bash: ls')
      useRun.getState().resolveTool('t1', 'boom', true)
      expect(useRun.getState().transcript.find((e) => e.kind === 'tool')).toMatchObject({
        status: 'error',
        resultText: 'boom',
      })
    })

    it('finish marks a still-running tool as done', () => {
      const useRun = createChatRunStore('test-tool-3')
      useRun.getState().start('hi')
      useRun.getState().pushTool('t1', 'Read: x')
      useRun.getState().finish('done')
      expect(useRun.getState().transcript.find((e) => e.kind === 'tool')).toMatchObject({
        status: 'done',
      })
    })
  })
})
