import type { BenchmarkTask } from '@main/services/benchmark/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Claude Agent SDK so runBenchmarkTask never spawns a real `claude`.
// queryImpl is swapped per-test to script the turn-by-turn behaviour.
let queryImpl: (args: {
  prompt: string
  options: { abortController?: AbortController; resume?: string }
}) => AsyncIterable<unknown>

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: Parameters<typeof queryImpl>[0]) => queryImpl(args),
}))

// Imported AFTER the mock is registered (vi.mock is hoisted).
const { runBenchmarkTask } = await import('@main/services/benchmark/runner')

function successResult(sessionId: string) {
  return {
    type: 'result' as const,
    subtype: 'success' as const,
    result: 'appPaths returns userData and migrations',
    num_turns: 1,
    duration_ms: 10,
    session_id: sessionId,
    total_cost_usd: 0.001,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }
}

// A turn that takes `delayMs` of wall-clock, but rejects early if its abort
// signal fires (mirrors the SDK giving up when the caller aborts).
function abortableTurn(sessionId: string, delayMs: number) {
  return async function* (args: {
    options: { abortController?: AbortController }
  }): AsyncIterable<unknown> {
    const signal = args.options.abortController?.signal
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'))
      const t = setTimeout(resolve, delayMs)
      signal?.addEventListener('abort', () => {
        clearTimeout(t)
        reject(new Error('aborted'))
      })
    })
    yield successResult(sessionId)
  }
}

const multiTurnTask: BenchmarkTask = {
  id: 'test-multi-turn',
  name: 'test multi turn',
  category: 'dialog',
  description: 'six fast turns whose sum exceeds a single shared budget',
  prompt: 'turn 0',
  followUps: ['turn 1', 'turn 2', 'turn 3', 'turn 4', 'turn 5'],
  assert: { type: 'includes', value: 'userData' },
}

describe('runBenchmarkTask multi-turn timeout', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('gives each turn its own timeout budget (a slow scenario is not killed mid-session)', async () => {
    // Six turns × 25ms = 150ms of cumulative wall-clock, but the per-turn
    // budget is 120ms — no single turn comes close. A shared budget would fire
    // mid-scenario and abort a healthy dialog; a per-turn budget must not.
    let turn = 0
    queryImpl = (args) => abortableTurn(`s${turn++}`, 25)(args)

    const result = await runBenchmarkTask(multiTurnTask, {
      model: 'test-model',
      repoRoot: '/tmp',
      timeoutMs: 120,
    })

    expect(result.failReason).toBeNull()
    expect(result.success).toBe(true)
  })

  it('still times out a turn that hangs past the per-turn budget', async () => {
    // Turn 0 completes (so the run has made progress), turn 1 hangs far past the
    // budget. The per-turn timer must still fire and abort the hung turn, and a
    // post-progress abort is classified as a real timeout.
    let turn = 0
    queryImpl = (args) => {
      const i = turn++
      return abortableTurn(`s${i}`, i === 0 ? 10 : 500)(args)
    }

    const result = await runBenchmarkTask(
      { ...multiTurnTask, followUps: ['turn 1'] },
      { model: 'test-model', repoRoot: '/tmp', timeoutMs: 60 },
    )

    expect(result.success).toBe(false)
    expect(result.failReason).toBe('timeout')
  })
})
