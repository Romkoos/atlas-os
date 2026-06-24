import { formatDuration } from '@renderer/components/layout/JobIndicator'
import { describe, expect, it } from 'vitest'

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(3_000)).toBe('3s')
    expect(formatDuration(59_000)).toBe('59s')
  })
  it('formats minutes with zero-padded seconds', () => {
    expect(formatDuration(64_000)).toBe('1m 04s')
    expect(formatDuration(125_000)).toBe('2m 05s')
  })
  it('formats hours with zero-padded minutes', () => {
    expect(formatDuration(3_660_000)).toBe('1h 01m')
  })
  it('never goes negative', () => {
    expect(formatDuration(-500)).toBe('0s')
  })
})
