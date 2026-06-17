import { selectTransientFailures } from '@main/services/benchmark/sweep'
import { describe, expect, it } from 'vitest'

const row = (success: boolean, failReason: string | null) => ({ success, failReason })

describe('selectTransientFailures', () => {
  it('selects only failed timeout/sdk_error rows', () => {
    const rows = [
      row(true, null),
      row(false, 'timeout'),
      row(false, 'sdk_error'),
      row(false, 'assertion_failed'),
      row(false, 'rate_limited'),
    ]
    const out = selectTransientFailures(rows)
    expect(out).toEqual([row(false, 'timeout'), row(false, 'sdk_error')])
  })

  it('never selects a successful row even if failReason is set', () => {
    expect(selectTransientFailures([row(true, 'timeout')])).toEqual([])
  })
})
