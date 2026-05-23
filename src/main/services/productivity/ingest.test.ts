import { turnId } from '@main/services/productivity/ids'
import {
  aggregateBySession,
  buildSessionRows,
  buildTurnRows,
} from '@main/services/productivity/ingest'
import type { AgentTurn } from '@main/services/productivity/transcript'
import { describe, expect, it } from 'vitest'

const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({
  sessionId: 's1',
  projectPath: '/proj',
  turnIndex: 0,
  ts: new Date('2026-05-23T10:00:00Z'),
  tokensIn: 0,
  tokensOut: 0,
  toolsUsed: [],
  skillsUsed: [],
  filesTouched: [],
  ...over,
})

describe('aggregateBySession', () => {
  it('sums tokens and counts turns per session', () => {
    const agg = aggregateBySession([
      turn({ sessionId: 's1', turnIndex: 0, tokensIn: 100, tokensOut: 10 }),
      turn({ sessionId: 's1', turnIndex: 1, tokensIn: 200, tokensOut: 20 }),
      turn({ sessionId: 's2', turnIndex: 0, tokensIn: 50, tokensOut: 5 }),
    ])

    expect(agg.get('s1')).toMatchObject({
      projectPath: '/proj',
      turnCount: 2,
      totalTokensIn: 300,
      totalTokensOut: 30,
      avgComplexity: 3, // stub complexityProxy = 3
    })
    expect(agg.get('s2')?.turnCount).toBe(1)
  })
})

describe('buildTurnRows', () => {
  it('assigns deterministic id and complexity proxy', () => {
    const rows = buildTurnRows([turn({ sessionId: 's1', turnIndex: 0, toolsUsed: ['Bash'] })])
    expect(rows[0]).toMatchObject({
      id: turnId('s1', 0),
      sessionId: 's1',
      turnIndex: 0,
      toolsUsed: ['Bash'],
      complexityProxy: 3,
    })
  })
})

describe('buildSessionRows', () => {
  const agg = aggregateBySession([turn({ sessionId: 's1', tokensIn: 100, tokensOut: 10 })])

  it('merges transcript aggregates with buffer lifecycle/score', () => {
    const rows = buildSessionRows(agg, [
      {
        sessionId: 's1',
        projectPath: '/proj',
        startedAt: new Date('2026-05-23T09:00:00Z'),
        endedAt: new Date('2026-05-23T10:00:00Z'),
        endReason: 'other',
        score: 8,
        summary: 'done',
      },
    ])
    const s1 = rows.find((r) => r.sessionId === 's1')
    expect(s1).toMatchObject({
      projectPath: '/proj',
      endReason: 'other',
      score: 8,
      summary: 'done',
      turnCount: 1,
      totalTokensIn: 100,
      totalTokensOut: 10,
      avgComplexity: 3,
    })
  })

  it('includes a buffer-only session with zero turns', () => {
    const rows = buildSessionRows(new Map(), [{ sessionId: 'sX', projectPath: '/p', score: 5 }])
    const sx = rows.find((r) => r.sessionId === 'sX')
    expect(sx).toMatchObject({ projectPath: '/p', score: 5, turnCount: 0, totalTokensIn: 0 })
    expect(sx?.avgComplexity ?? null).toBeNull()
  })

  it('includes a transcript-only session with null score', () => {
    const rows = buildSessionRows(agg, [])
    const s1 = rows.find((r) => r.sessionId === 's1')
    expect(s1?.turnCount).toBe(1)
    expect(s1?.score ?? null).toBeNull()
  })
})
