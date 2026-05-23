import { complexityProxy } from '@main/services/productivity/complexity'
import type { AgentTurn } from '@main/services/productivity/transcript'
import { describe, expect, it } from 'vitest'

const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({
  sessionId: 's1',
  projectPath: '/proj',
  turnIndex: 0,
  ts: new Date(0),
  tokensIn: 0,
  tokensOut: 0,
  toolsUsed: [],
  skillsUsed: [],
  filesTouched: [],
  ...over,
})

describe('complexityProxy', () => {
  // Stub: always the middle of the 1–5 scale until a real heuristic lands.
  it('returns the middle value (3) regardless of the turn', () => {
    expect(complexityProxy(turn())).toBe(3)
    expect(complexityProxy(turn({ tokensIn: 99999, toolsUsed: ['a', 'b', 'c'] }))).toBe(3)
  })
})
