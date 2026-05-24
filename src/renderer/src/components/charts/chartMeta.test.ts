import { describe, expect, it } from 'vitest'
import { CHART_METAS, kpiMeta, tokensPerDayMeta } from './chartMeta'

describe('chartMeta', () => {
  it('every chart has unique series keys and a color', () => {
    for (const meta of Object.values(CHART_METAS)) {
      const keys = meta.series.map((s) => s.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const s of meta.series) expect(s.color).toMatch(/^var\(/)
    }
  })

  it('КПД chart exposes a formula for the ? popover', () => {
    expect(kpiMeta.formula).toBeDefined()
    expect(kpiMeta.formula?.body).toMatch(/baseline/i)
  })

  it('the two daily charts share a sync group', () => {
    expect(tokensPerDayMeta.syncGroup).toBeDefined()
    expect(kpiMeta.syncGroup).toBe(tokensPerDayMeta.syncGroup)
  })
})
