import { describe, expect, it } from 'vitest'
import { buildTranscriptTimeline } from './buildTranscriptTimeline'

// Minimal transcript-line factories mirroring ~/.claude/projects/**/*.jsonl.
const asst = (
  ts: string,
  blocks: unknown[],
  usage?: Record<string, number>,
  sidechain = false,
) => ({
  type: 'assistant',
  timestamp: ts,
  isSidechain: sidechain,
  message: { content: blocks, usage },
})
const userResult = (ts: string, id: string, isError = false, sidechain = false) => ({
  type: 'user',
  timestamp: ts,
  isSidechain: sidechain,
  message: {
    content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }],
  },
})
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}) => ({
  type: 'tool_use',
  id,
  name,
  input,
})

describe('buildTranscriptTimeline', () => {
  it('pairs tool_use with tool_result by id and accumulates tokens', () => {
    const lines = [
      asst('2026-07-06T00:00:00.100Z', [toolUse('t1', 'Read', { file_path: 'a.ts' })], {
        input_tokens: 10,
        output_tokens: 4,
        cache_creation_input_tokens: 2,
      }),
      userResult('2026-07-06T00:00:00.300Z', 't1'),
    ]
    const tl = buildTranscriptTimeline('s', lines)
    expect(tl.source).toBe('transcript')
    expect(tl.spans).toHaveLength(1)
    expect(tl.spans[0]).toMatchObject({ id: 't1', name: 'Read', isError: false, depth: 0 })
    expect(tl.spans[0].endMs).toBeGreaterThan(tl.spans[0].startMs)
    expect(tl.tokens).toEqual([
      { tMs: Date.parse('2026-07-06T00:00:00.100Z'), inTokens: 12, outTokens: 4 },
    ])
  })

  it('nests sidechain tool spans under the enclosing Task by time containment', () => {
    const lines = [
      asst('2026-07-06T00:00:01.000Z', [toolUse('task1', 'Task', { subagent_type: 'Explore' })]),
      // sidechain child runs inside the Task window:
      asst(
        '2026-07-06T00:00:01.200Z',
        [toolUse('c1', 'Grep', { pattern: 'foo' })],
        undefined,
        true,
      ),
      userResult('2026-07-06T00:00:01.400Z', 'c1', false, true),
      userResult('2026-07-06T00:00:02.000Z', 'task1'),
    ]
    const tl = buildTranscriptTimeline('s', lines)
    const top = tl.spans.filter((s) => s.depth === 0)
    expect(top).toHaveLength(1)
    expect(top[0]).toMatchObject({ id: 'task1', subagentType: 'Explore' })
    expect(top[0].children).toHaveLength(1)
    expect(top[0].children?.[0]).toMatchObject({ id: 'c1', name: 'Grep', depth: 1 })
  })
})
