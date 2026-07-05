import { describe, expect, it } from 'vitest'
import { SUBSCRIPTION_LIMITS, SUBSCRIPTION_PLANS, subscriptionLimitTokens } from './settings'

describe('subscriptionLimitTokens', () => {
  it('returns the lookup value for known plans', () => {
    expect(subscriptionLimitTokens({ subscriptionPlan: 'pro', subscriptionLimitCustom: 99 })).toBe(
      SUBSCRIPTION_LIMITS.pro,
    )
    expect(
      subscriptionLimitTokens({ subscriptionPlan: 'max5x', subscriptionLimitCustom: 99 }),
    ).toBe(SUBSCRIPTION_LIMITS.max5x)
    expect(
      subscriptionLimitTokens({ subscriptionPlan: 'max20x', subscriptionLimitCustom: 99 }),
    ).toBe(SUBSCRIPTION_LIMITS.max20x)
  })

  it('returns subscriptionLimitCustom when plan is custom', () => {
    expect(
      subscriptionLimitTokens({ subscriptionPlan: 'custom', subscriptionLimitCustom: 12345 }),
    ).toBe(12345)
  })

  it('SUBSCRIPTION_PLANS contains all four values', () => {
    expect(SUBSCRIPTION_PLANS).toEqual(['pro', 'max5x', 'max20x', 'custom'])
  })
})
