import { describe, expect, it } from 'vitest'
import { tabsForType } from './canvasTabs'

describe('tabsForType', () => {
  it('appends the Artifact tab after roadmap Ideas', () => {
    expect(tabsForType('roadmap').map((t) => t.label)).toEqual(['Ideas', 'Artifact'])
  })
  it('appends the Artifact tab after skillImprover Report', () => {
    expect(tabsForType('skillImprover').map((t) => t.label)).toEqual(['Report', 'Artifact'])
  })
  it('gives worker and generalChat the Artifact tab as their only tab', () => {
    expect(tabsForType('worker').map((t) => t.label)).toEqual(['Artifact'])
    expect(tabsForType('generalChat').map((t) => t.label)).toEqual(['Artifact'])
  })
})
