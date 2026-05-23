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
  it('sums tokens, counts turns, and unions scope signals per session', () => {
    const agg = aggregateBySession([
      turn({
        sessionId: 's1',
        turnIndex: 0,
        tokensIn: 100,
        tokensOut: 10,
        toolsUsed: ['Read', 'Edit'],
        skillsUsed: ['brainstorming'],
        filesTouched: ['/proj/a.ts', '/proj/sub/b.ts'],
      }),
      turn({
        sessionId: 's1',
        turnIndex: 1,
        tokensIn: 200,
        tokensOut: 20,
        toolsUsed: ['Edit', 'Task'], // Edit dup; Task = subagent
        skillsUsed: [],
        filesTouched: ['/proj/a.ts', '/proj/c.ts'], // a.ts dup
      }),
      turn({ sessionId: 's2', turnIndex: 0, tokensIn: 50, tokensOut: 5 }),
    ])

    expect(agg.get('s1')).toMatchObject({
      projectPath: '/proj',
      turnCount: 2,
      totalTokensIn: 300,
      totalTokensOut: 30,
      distinctFiles: 3, // a.ts, b.ts, c.ts
      distinctDirs: 2, // /proj, /proj/sub
      distinctTools: 3, // Read, Edit, Task
      distinctSkills: 1, // brainstorming
      subagentCount: 1, // one turn used Task
    })
    expect(agg.get('s2')).toMatchObject({ turnCount: 1, distinctFiles: 0, subagentCount: 0 })
  })
})

describe('buildTurnRows', () => {
  it('assigns deterministic id and passes through scope fields', () => {
    const rows = buildTurnRows([
      turn({ sessionId: 's1', turnIndex: 0, toolsUsed: ['Bash'], filesTouched: ['/p/x.ts'] }),
    ])
    expect(rows[0]).toMatchObject({
      id: turnId('s1', 0),
      sessionId: 's1',
      turnIndex: 0,
      toolsUsed: ['Bash'],
      filesTouched: ['/p/x.ts'],
    })
  })
})

describe('buildSessionRows', () => {
  const agg = aggregateBySession([
    turn({
      sessionId: 's1',
      tokensIn: 100,
      tokensOut: 10,
      toolsUsed: ['Read'],
      filesTouched: ['/proj/a.ts'],
    }),
  ])

  it('merges transcript aggregates with buffer lifecycle, ignoring buffer score', () => {
    const rows = buildSessionRows(agg, [
      {
        sessionId: 's1',
        projectPath: '/proj',
        startedAt: new Date('2026-05-23T09:00:00Z'),
        endedAt: new Date('2026-05-23T10:00:00Z'),
        endReason: 'other',
        score: 8, // agent self-score — must be ignored now
        summary: 'done',
      },
    ])
    const s1 = rows.find((r) => r.sessionId === 's1')
    expect(s1).toMatchObject({
      projectPath: '/proj',
      endReason: 'other',
      summary: 'done',
      turnCount: 1,
      totalTokensIn: 100,
      totalTokensOut: 10,
      distinctFiles: 1,
      distinctTools: 1,
    })
    expect(s1?.score ?? null).toBeNull() // self-score dropped
  })

  it('includes a buffer-only session with zero turns and null score', () => {
    const rows = buildSessionRows(new Map(), [{ sessionId: 'sX', projectPath: '/p', score: 5 }])
    const sx = rows.find((r) => r.sessionId === 'sX')
    expect(sx).toMatchObject({
      projectPath: '/p',
      turnCount: 0,
      totalTokensIn: 0,
      distinctFiles: 0,
    })
    expect(sx?.score ?? null).toBeNull()
  })

  it('transcript-only session has null lifecycle and correct scope counts', () => {
    const rows = buildSessionRows(agg, []) // no buffer record
    const s1 = rows.find((r) => r.sessionId === 's1')
    expect(s1?.startedAt ?? null).toBeNull()
    expect(s1?.endedAt ?? null).toBeNull()
    expect(s1).toMatchObject({
      turnCount: 1,
      totalTokensIn: 100,
      totalTokensOut: 10,
      distinctFiles: 1,
    })
    expect(s1?.score ?? null).toBeNull()
  })
})
