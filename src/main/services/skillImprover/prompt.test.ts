import { buildImproverPrompt, REPORT_SENTINEL } from '@main/services/skillImprover/prompt'
import { describe, expect, it } from 'vitest'

describe('buildImproverPrompt', () => {
  const args = {
    skillCreatorPath: '/plugins/skill-creator/SKILL.md',
    skillPath: '/home/u/.claude/skills/graphify',
    skillName: 'graphify',
    workspace: '/tmp/atlas-improver-abc',
    reportPath: '/tmp/atlas-improver-abc/report.json',
  }

  it('includes the skill path, workspace, report path, and sentinel', () => {
    const p = buildImproverPrompt(args)
    expect(p).toContain('/home/u/.claude/skills/graphify')
    expect(p).toContain('/tmp/atlas-improver-abc')
    expect(p).toContain('/tmp/atlas-improver-abc/report.json')
    expect(p).toContain(REPORT_SENTINEL)
  })

  it('references the skill-creator skill by absolute path', () => {
    expect(buildImproverPrompt(args)).toContain('/plugins/skill-creator/SKILL.md')
  })

  it('forbids opening browser viewers', () => {
    expect(buildImproverPrompt(args).toLowerCase()).toContain('do not open')
  })
})
