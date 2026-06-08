import { improverReportSchema, parseImproverReport } from '@shared/skillImprover'
import { describe, expect, it } from 'vitest'

describe('improverReportSchema', () => {
  it('accepts a full report', () => {
    const report = {
      skillName: 'graphify',
      iterations: [
        {
          n: 0,
          passRate: 0.5,
          tokens: 1000,
          durationMs: 12000,
          perEval: [{ name: 'extracts entities', passed: false, notes: 'missed two' }],
        },
        { n: 1, passRate: 0.9, tokens: 1200, durationMs: 14000, perEval: [] },
      ],
      beforeDescription: 'old desc',
      afterDescription: 'new desc',
      diffSummary: 'tightened the trigger language',
      analystSummary: 'iteration 1 fixed entity coverage',
    }
    expect(improverReportSchema.parse(report).skillName).toBe('graphify')
  })

  it('accepts a minimal report (only required fields)', () => {
    const report = { skillName: 'x', iterations: [{ n: 0 }] }
    expect(improverReportSchema.parse(report).iterations[0].n).toBe(0)
  })

  it('parseImproverReport returns null on malformed JSON', () => {
    expect(parseImproverReport('not json{')).toBeNull()
  })

  it('parseImproverReport returns null when schema does not match', () => {
    expect(parseImproverReport(JSON.stringify({ skillName: 'x' }))).toBeNull()
  })

  it('parseImproverReport parses a valid JSON string', () => {
    const json = JSON.stringify({ skillName: 'x', iterations: [{ n: 0 }] })
    expect(parseImproverReport(json)?.skillName).toBe('x')
  })
})
