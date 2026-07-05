import { describe, expect, it, vi } from 'vitest'
import { SubscriptionUsage } from './subscriptionUsage'

describe('SubscriptionUsage', () => {
  it('starts empty and stores the latest snapshot', () => {
    const u = new SubscriptionUsage()
    expect(u.snapshot()).toBeNull()
    u.update({ status: 'allowed', utilization: 0.4, resetsAt: 123, rateLimitType: 'five_hour' })
    expect(u.snapshot()).toEqual({
      status: 'allowed',
      utilization: 0.4,
      resetsAt: 123,
      rateLimitType: 'five_hour',
    })
  })
  it('notifies subscribers on update and stops after unsubscribe', () => {
    const u = new SubscriptionUsage()
    const cb = vi.fn()
    const off = u.onChange(cb)
    u.update({ status: 'rejected' })
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    u.update({ status: 'allowed' })
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
