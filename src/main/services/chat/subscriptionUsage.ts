import type { RateLimitInfo } from '@shared/ipc-events'

// Main-side cache of the last-known subscription rate-limit snapshot, fed by any
// chat run's rate_limit_event. Mirrors the jobRegistry snapshot/onChange shape.
export class SubscriptionUsage {
  private current: RateLimitInfo | null = null
  private listeners = new Set<() => void>()

  update(info: RateLimitInfo): void {
    this.current = info
    for (const cb of this.listeners) cb()
  }

  snapshot(): RateLimitInfo | null {
    return this.current
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }
}

export const subscriptionUsage = new SubscriptionUsage()
