import type { RateLimitInfo, UsageSnapshot, UsageWindow } from '@shared/ipc-events'

// Main-side cache of the last-known subscription usage snapshot, fed by the
// periodic `/usage` poll (all windows) and by any chat run's live
// rate_limit_event (a single window). Mirrors the jobRegistry snapshot/onChange
// shape. `now` is injected on update so callers control the fetched-at stamp.
export class SubscriptionUsage {
  private current: UsageSnapshot | null = null
  private listeners = new Set<() => void>()

  // Full snapshot from a `/usage` poll (session + weekly windows).
  updateFromPoll(windows: UsageWindow[], now: number): void {
    this.current = { windows, fetchedAt: now, source: 'poll' }
    this.emit()
  }

  // A single window harvested from a live rate_limit_event during a chat run.
  // Kept as its own snapshot so the gauge still shows something between polls.
  updateFromEvent(info: RateLimitInfo, now: number): void {
    this.current = {
      windows: [
        {
          label: info.rateLimitType ?? 'session',
          status: info.status,
          utilization: info.utilization ?? 0,
          resetsAt: info.resetsAt,
        },
      ],
      fetchedAt: now,
      source: 'event',
    }
    this.emit()
  }

  snapshot(): UsageSnapshot | null {
    return this.current
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(): void {
    for (const cb of this.listeners) cb()
  }
}

export const subscriptionUsage = new SubscriptionUsage()
