import { describe, expect, it } from 'vitest'
import {
  APPROVE_BUILD_LABEL,
  buildDevBuildPrompt,
  buildDevPlanKickoff,
  DEPLOY_SENTINEL,
  parseDeploySentinel,
  shouldApproveBuild,
} from './roadmap'

describe('parseDeploySentinel', () => {
  it('matches the sentinel alone on its own line', () => {
    expect(parseDeploySentinel(`merged to main\n${DEPLOY_SENTINEL}`)).toBe(true)
  })
  it('tolerates surrounding whitespace on the line', () => {
    expect(parseDeploySentinel(`done\n   ${DEPLOY_SENTINEL}  \n`)).toBe(true)
  })
  it('ignores the token mentioned inside prose (not on its own line)', () => {
    expect(parseDeploySentinel(`I will emit ${DEPLOY_SENTINEL} when finished`)).toBe(false)
  })
  it('returns false when absent', () => {
    expect(parseDeploySentinel('still building')).toBe(false)
  })
})

describe('shouldApproveBuild', () => {
  it('is true only when planning AND the exact approve label was picked', () => {
    expect(shouldApproveBuild({ itemId: 'a', phase: 'planning' }, APPROVE_BUILD_LABEL)).toBe(true)
  })
  it('is false while building (already approved)', () => {
    expect(shouldApproveBuild({ itemId: 'a', phase: 'building' }, APPROVE_BUILD_LABEL)).toBe(false)
  })
  it('is false for any other picked text', () => {
    expect(shouldApproveBuild({ itemId: 'a', phase: 'planning' }, 'refine the plan')).toBe(false)
  })
  it('is false with no binding', () => {
    expect(shouldApproveBuild(null, APPROVE_BUILD_LABEL)).toBe(false)
  })
})

describe('prompt builders', () => {
  it('plan kickoff embeds the brief, forbids code, and pins the approve label', () => {
    const seed = buildDevPlanKickoff({ title: 'Widget', claudePrompt: 'Build a widget' })
    expect(seed).toContain('Widget')
    expect(seed).toContain('Build a widget')
    expect(seed).toContain(APPROVE_BUILD_LABEL)
    expect(seed.toLowerCase()).toContain('do not write code')
  })
  it('build prompt forbids push/merge until deploy and pins the sentinel contract', () => {
    const p = buildDevBuildPrompt()
    expect(p.toLowerCase()).toContain('do not push')
    expect(p).toContain('deploy')
    expect(p).toContain(DEPLOY_SENTINEL)
  })
})
