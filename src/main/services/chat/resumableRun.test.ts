import { describe, expect, it, vi } from 'vitest'

const queryMock = vi.fn()
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }))
vi.mock('@main/services/llm/subscriptionEnv', () => ({ subscriptionEnv: () => ({}) }))

import { startResumableChat } from './resumableRun'

// biome-ignore lint/suspicious/noExplicitAny: test fixtures for fake SDK messages
function fakeQuery(messages: any[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m
    },
    interrupt: async () => {},
  }
}

describe('startResumableChat', () => {
  it('passes options.sessionId for a new session and emits token+awaiting', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: captured SDK arg
    let captured: any
    // biome-ignore lint/suspicious/noExplicitAny: mock impl
    queryMock.mockImplementation((arg: any) => {
      captured = arg
      return fakeQuery([
        {
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
        },
        { type: 'result', subtype: 'success' },
      ])
    })
    // biome-ignore lint/suspicious/noExplicitAny: collected events
    const events: any[] = []
    const run = startResumableChat({
      sessionId: 'uuid-1',
      model: 'claude-opus-4-8',
      cwd: '/repo',
      allowedTools: ['Read'],
      settingSources: ['user'],
      env: {},
      seed: 'hello',
      resume: false,
      emit: (e) => events.push(e),
    })
    await run.done
    expect(captured.options.sessionId).toBe('uuid-1')
    expect(captured.options.resume).toBeUndefined()
    expect(events).toEqual([{ type: 'token', text: 'hi' }, { type: 'awaiting-input' }])
  })

  it('passes options.resume when resuming with no seed', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: captured SDK arg
    let captured: any
    // biome-ignore lint/suspicious/noExplicitAny: mock impl
    queryMock.mockImplementation((arg: any) => {
      captured = arg
      return fakeQuery([{ type: 'result', subtype: 'success' }])
    })
    const run = startResumableChat({
      sessionId: 'uuid-2',
      model: 'm',
      cwd: '/repo',
      allowedTools: [],
      settingSources: ['user'],
      env: {},
      resume: true,
      emit: () => {},
    })
    await run.done
    expect(captured.options.resume).toBe('uuid-2')
    expect(captured.options.sessionId).toBeUndefined()
  })
})
