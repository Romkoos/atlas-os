import type { TimelineEvent } from '@shared/timeline'
import { describe, expect, it } from 'vitest'
import { buildLiveTimeline } from './buildLiveTimeline'

describe('buildLiveTimeline', () => {
  it('pairs tool + tool-result into a closed span', () => {
    const events: TimelineEvent[] = [
      { type: 'tool', toolId: 't1', name: 'Read', summary: 'Read: a.ts', ts: 100 },
      { type: 'tool-result', toolId: 't1', ts: 250, isError: false },
    ]
    const tl = buildLiveTimeline('s', events, 999)
    expect(tl.spans).toHaveLength(1)
    expect(tl.spans[0]).toMatchObject({
      id: 't1',
      startMs: 100,
      endMs: 250,
      isError: false,
      depth: 0,
    })
    expect(tl.startMs).toBe(100)
    expect(tl.source).toBe('live')
  })

  it('leaves an unresolved tool open (endMs null) while running', () => {
    const events: TimelineEvent[] = [
      { type: 'tool', toolId: 't1', name: 'Bash', summary: 'Bash', ts: 100 },
    ]
    const tl = buildLiveTimeline('s', events, 500)
    expect(tl.spans[0].endMs).toBeNull()
    expect(tl.endMs).toBeNull()
  })

  it('closes open spans at the end event when the run finished', () => {
    const events: TimelineEvent[] = [
      { type: 'tool', toolId: 't1', name: 'Bash', summary: 'Bash', ts: 100 },
      { type: 'end', ts: 400 },
    ]
    const tl = buildLiveTimeline('s', events, 999)
    expect(tl.spans[0].endMs).toBe(400)
    expect(tl.endMs).toBe(400)
  })

  it('carries subagentType and builds the cumulative token series', () => {
    const events: TimelineEvent[] = [
      {
        type: 'tool',
        toolId: 't1',
        name: 'Task',
        summary: 'Task: Explore',
        ts: 100,
        subagentType: 'Explore',
      },
      { type: 'usage', ts: 120, inputTokens: 10, outputTokens: 3 },
      { type: 'usage', ts: 200, inputTokens: 25, outputTokens: 9 },
    ]
    const tl = buildLiveTimeline('s', events, 999)
    expect(tl.spans[0].subagentType).toBe('Explore')
    expect(tl.tokens).toEqual([
      { tMs: 120, inTokens: 10, outTokens: 3 },
      { tMs: 200, inTokens: 25, outTokens: 9 },
    ])
  })
})
