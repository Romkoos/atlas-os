import type { SignalView } from '@shared/signals'
import { describe, expect, it } from 'vitest'
import { capSignalsForPanel, SIGNALS_PANEL_LIMIT } from './signals-feed'

function sig(id: number): SignalView {
  return {
    id,
    source: 'jobs',
    type: 'job',
    severity: 'info',
    title: `Signal ${id}`,
    detail: null,
    link: null,
    linkKind: null,
    createdAt: 1000 + id,
    readAt: null,
  }
}

function feed(n: number): SignalView[] {
  return Array.from({ length: n }, (_, i) => sig(i))
}

describe('capSignalsForPanel', () => {
  it('caps the dashboard panel at 10 signals', () => {
    expect(SIGNALS_PANEL_LIMIT).toBe(10)
    expect(capSignalsForPanel(feed(25))).toHaveLength(10)
  })

  it('keeps the first N (most-recent-first ordering preserved)', () => {
    const capped = capSignalsForPanel(feed(25))
    expect(capped[0].id).toBe(0)
    expect(capped[9].id).toBe(9)
  })

  it('returns all signals when fewer than the limit', () => {
    expect(capSignalsForPanel(feed(3))).toHaveLength(3)
  })

  it('returns an empty array for an empty feed', () => {
    expect(capSignalsForPanel([])).toEqual([])
  })

  it('returns exactly the limit at the boundary', () => {
    expect(capSignalsForPanel(feed(10))).toHaveLength(10)
  })
})
