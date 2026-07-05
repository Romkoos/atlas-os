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

  it('normalizes SDK resetsAt from epoch seconds to ms on both emit and callback', async () => {
    // The SDK reports resetsAt as Unix epoch SECONDS; all downstream consumers
    // (widget countdown, auto-continue backoff) assume ms. Convert at the source.
    const resetsAtSec = 1_751_000_000
    queryMock.mockImplementation(() =>
      fakeQuery([
        {
          type: 'rate_limit_event',
          rate_limit_info: {
            status: 'rejected',
            utilization: 1.02,
            resetsAt: resetsAtSec,
            rateLimitType: 'five_hour',
          },
        },
        { type: 'result', subtype: 'success' },
      ]),
    )
    // biome-ignore lint/suspicious/noExplicitAny: collected events / callback info
    const events: any[] = []
    // biome-ignore lint/suspicious/noExplicitAny: captured callback info
    let cbInfo: any
    const run = startResumableChat({
      sessionId: 'uuid-rl',
      model: 'm',
      cwd: '/repo',
      allowedTools: [],
      settingSources: ['user'],
      env: {},
      resume: false,
      seed: 'go',
      emit: (e) => events.push(e),
      onRateLimit: (info) => {
        cbInfo = info
      },
    })
    await run.done
    const emitted = events.find((e) => e.type === 'rate-limit')
    expect(emitted.resetsAt).toBe(resetsAtSec * 1000)
    expect(cbInfo.resetsAt).toBe(resetsAtSec * 1000)
    // utilization is passed through unchanged (clamping is a presentation concern).
    expect(cbInfo.utilization).toBe(1.02)
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
