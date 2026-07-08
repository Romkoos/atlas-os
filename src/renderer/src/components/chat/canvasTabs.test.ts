import { describe, expect, it } from 'vitest'
import { tabsForType } from './canvasTabs'

describe('tabsForType', () => {
  it('gives roadmap an Ideas tab', () => {
    expect(tabsForType('roadmap').map((t) => t.label)).toEqual(['Ideas'])
  })
  it('gives skillImprover a Report tab', () => {
    expect(tabsForType('skillImprover').map((t) => t.label)).toEqual(['Report'])
  })
  it('gives worker and generalChat no tabs in phase 1', () => {
    expect(tabsForType('worker')).toEqual([])
    expect(tabsForType('generalChat')).toEqual([])
  })
})
