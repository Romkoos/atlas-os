import { describe, expect, it, vi } from 'vitest'
import { SubscriptionUsage } from './subscriptionUsage'

describe('SubscriptionUsage', () => {
  it('starts empty and stores the latest poll snapshot with fetchedAt/source', () => {
    const u = new SubscriptionUsage()
    expect(u.snapshot()).toBeNull()
    const windows = [
      { label: 'session', status: 'allowed' as const, utilization: 0.4, resetsAt: 123 },
      { label: 'week', status: 'allowed' as const, utilization: 0.28 },
    ]
    u.updateFromPoll(windows, 1_000)
    expect(u.snapshot()).toEqual({ windows, fetchedAt: 1_000, source: 'poll' })
  })

  it('wraps a single live rate_limit_event into a one-window event snapshot', () => {
    const u = new SubscriptionUsage()
    u.updateFromEvent(
      { status: 'rejected', utilization: 1.02, resetsAt: 456, rateLimitType: 'seven_day' },
      2_000,
    )
    expect(u.snapshot()).toEqual({
      windows: [{ label: 'seven_day', status: 'rejected', utilization: 1.02, resetsAt: 456 }],
      fetchedAt: 2_000,
      source: 'event',
    })
  })

  it('notifies subscribers on update and stops after unsubscribe', () => {
    const u = new SubscriptionUsage()
    const cb = vi.fn()
    const off = u.onChange(cb)
    u.updateFromPoll([{ label: 'session', status: 'allowed', utilization: 0.1 }], 1)
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    u.updateFromPoll([{ label: 'session', status: 'allowed', utilization: 0.2 }], 2)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
