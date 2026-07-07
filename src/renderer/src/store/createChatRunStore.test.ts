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

  describe('autonomous flag', () => {
    it('defaults to false on a fresh store', () => {
      const useStore = createChatRunStore('atlas-chat-run-auto-default')
      expect(useStore.getState().autonomous).toBe(false)
    })

    it('start defaults autonomous to false when the arg is omitted', () => {
      const useStore = createChatRunStore('atlas-chat-run-auto-omit')
      useStore.getState().start('hi')
      expect(useStore.getState().autonomous).toBe(false)
    })

    it('start captures an explicit autonomous flag', () => {
      const useStore = createChatRunStore('atlas-chat-run-auto-set')
      useStore.getState().start('hi', null, true)
      expect(useStore.getState().autonomous).toBe(true)
    })

    it('start with autonomous omitted keeps the current value (like model)', () => {
      const useStore = createChatRunStore('atlas-chat-run-auto-keep')
      useStore.getState().start('one', null, true)
      useStore.getState().start('two')
      expect(useStore.getState().autonomous).toBe(true)
    })

    it('reset clears autonomous back to false', () => {
      const useStore = createChatRunStore('atlas-chat-run-auto-reset')
      useStore.getState().start('hi', null, true)
      useStore.getState().reset()
      expect(useStore.getState().autonomous).toBe(false)
    })
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

  describe('segment-flush (readability)', () => {
    it('pushTool commits pending streaming as its own assistant entry, before the tool', () => {
      const useRun = createChatRunStore('test-seg-1')
      useRun.getState().start('q')
      useRun.getState().appendToken('Let me look at the file.')
      useRun.getState().pushTool('t1', 'Read', 'Read: store.ts')
      const t = useRun.getState().transcript
      // user, assistant-segment, tool — in that order
      expect(t).toEqual([
        { kind: 'user', text: 'q' },
        { kind: 'assistant', text: 'Let me look at the file.' },
        { kind: 'tool', id: 't1', name: 'Read', text: 'Read: store.ts', status: 'running' },
      ])
      expect(useRun.getState().streaming).toBe('')
    })

    it('produces two ordered assistant segments split by an intervening tool', () => {
      const useRun = createChatRunStore('test-seg-2')
      useRun.getState().start('q')
      useRun.getState().appendToken('First segment.')
      useRun.getState().pushTool('t1', 'Read', 'Read: x')
      useRun.getState().resolveTool('t1', 'ok', false)
      useRun.getState().appendToken('Second segment.')
      useRun.getState().flushTurn()
      const kinds = useRun.getState().transcript.map((e) => e.kind)
      expect(kinds).toEqual(['user', 'assistant', 'tool', 'assistant'])
      const assistants = useRun
        .getState()
        .transcript.filter((e) => e.kind === 'assistant')
        .map((e) => (e as { text: string }).text)
      expect(assistants).toEqual(['First segment.', 'Second segment.'])
    })

    it('pushTool with no pending streaming adds no spurious assistant entry', () => {
      const useRun = createChatRunStore('test-seg-3')
      useRun.getState().start('q')
      useRun.getState().pushTool('t1', 'Read', 'Read: x')
      useRun.getState().pushTool('t2', 'Grep', 'Grep: y')
      expect(useRun.getState().transcript.filter((e) => e.kind === 'assistant')).toHaveLength(0)
    })
  })

  describe('subagent nested activity', () => {
    it('appendSubToken accumulates streaming under the parent Task id', () => {
      const useRun = createChatRunStore('test-sub-1')
      useRun.getState().start('q')
      useRun.getState().appendSubToken('task1', 'sub ')
      useRun.getState().appendSubToken('task1', 'text')
      expect(useRun.getState().subagents.task1).toEqual({ transcript: [], streaming: 'sub text' })
      // Top-level streaming is untouched.
      expect(useRun.getState().streaming).toBe('')
    })

    it('pushSubTool segment-flushes sub-streaming then adds a running sub-tool', () => {
      const useRun = createChatRunStore('test-sub-2')
      useRun.getState().start('q')
      useRun.getState().appendSubToken('task1', 'Working on it.')
      useRun.getState().pushSubTool('task1', 's1', 'Grep', 'Grep: foo')
      const sub = useRun.getState().subagents.task1
      expect(sub.transcript).toEqual([
        { kind: 'assistant', text: 'Working on it.' },
        { kind: 'tool', id: 's1', name: 'Grep', text: 'Grep: foo', status: 'running' },
      ])
      expect(sub.streaming).toBe('')
    })

    it('resolveSubTool completes the matching sub-tool', () => {
      const useRun = createChatRunStore('test-sub-3')
      useRun.getState().start('q')
      useRun.getState().pushSubTool('task1', 's1', 'Grep', 'Grep: foo')
      useRun.getState().resolveSubTool('task1', 's1', 'match', false)
      expect(
        useRun.getState().subagents.task1.transcript.find((e) => e.kind === 'tool'),
      ).toMatchObject({ id: 's1', status: 'done', resultText: 'match' })
    })

    it('resolveTool on the Task sweeps trailing sub-streaming and settles running sub-tools', () => {
      const useRun = createChatRunStore('test-sub-4')
      useRun.getState().start('q')
      useRun.getState().pushTool('task1', 'Task', 'Task: explore')
      useRun.getState().pushSubTool('task1', 's1', 'Read', 'Read: a')
      // s1 never resolves; subagent leaves trailing prose.
      useRun.getState().appendSubToken('task1', 'Done exploring.')
      useRun.getState().resolveTool('task1', 'summary', false)
      const sub = useRun.getState().subagents.task1
      expect(sub.streaming).toBe('')
      // trailing prose committed, and the dangling sub-tool settled to done
      expect(sub.transcript).toEqual([
        { kind: 'tool', id: 's1', name: 'Read', text: 'Read: a', status: 'done' },
        { kind: 'assistant', text: 'Done exploring.' },
      ])
      // the Task's own top-level row is resolved
      expect(useRun.getState().transcript.find((e) => e.kind === 'tool')).toMatchObject({
        id: 'task1',
        status: 'done',
        resultText: 'summary',
      })
    })

    it('start and reset clear the subagents map', () => {
      const useRun = createChatRunStore('test-sub-5')
      useRun.getState().start('q')
      useRun.getState().appendSubToken('task1', 'x')
      expect(Object.keys(useRun.getState().subagents)).toHaveLength(1)
      useRun.getState().reset()
      expect(useRun.getState().subagents).toEqual({})
    })
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
      useRun.getState().pushTool('t1', 'Read', 'Read: store.ts')
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
      useRun.getState().pushTool('t1', 'Bash', 'Bash: ls')
      useRun.getState().resolveTool('t1', 'boom', true)
      expect(useRun.getState().transcript.find((e) => e.kind === 'tool')).toMatchObject({
        status: 'error',
        resultText: 'boom',
      })
    })

    it('finish marks a still-running tool as done', () => {
      const useRun = createChatRunStore('test-tool-3')
      useRun.getState().start('hi')
      useRun.getState().pushTool('t1', 'Read', 'Read: x')
      useRun.getState().finish('done')
      expect(useRun.getState().transcript.find((e) => e.kind === 'tool')).toMatchObject({
        status: 'done',
      })
    })
  })

  it('accumulates timelineEvents and clears them on reset/start', () => {
    const useRun = createChatRunStore('test-timeline')
    useRun.getState().start('hi')
    expect(useRun.getState().timelineEvents).toEqual([])
    useRun
      .getState()
      .pushTimelineEvent({ type: 'tool', toolId: 't1', name: 'Read', summary: 'Read', ts: 1 })
    expect(useRun.getState().timelineEvents).toHaveLength(1)
    useRun.getState().reset()
    expect(useRun.getState().timelineEvents).toEqual([])
  })

  it('freshStart is true only for a session started in this app session', () => {
    const useRun = createChatRunStore('test-fresh-start')
    useRun.getState().start('hi')
    expect(useRun.getState().freshStart).toBe(true)

    useRun.getState().reattach()
    expect(useRun.getState().freshStart).toBe(false)

    useRun.getState().reset()
    expect(useRun.getState().freshStart).toBe(false)
  })
})
