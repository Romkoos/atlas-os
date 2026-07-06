import { readFileSync, writeFileSync } from 'node:fs'
import { logger } from '@main/logger'
import type { RateLimitInfo, UsageSnapshot, UsageWindow } from '@shared/ipc-events'

// Main-side cache of the last-known subscription usage snapshot, fed by the
// periodic `/usage` poll (all windows) and by any chat run's live
// rate_limit_event (a single window). Mirrors the jobRegistry snapshot/onChange
// shape. `now` is injected on update so callers control the fetched-at stamp.
//
// The latest snapshot is also persisted to disk and restored on startup, so a
// cold start (or a spell where the rate-limited `/usage` endpoint returns no
// window data) shows the last known value — stamped "updated Xm ago" — instead
// of blanking the gauge.
export class SubscriptionUsage {
  private current: UsageSnapshot | null = null
  private listeners = new Set<() => void>()
  private persistPath: string | null = null

  // Load the snapshot persisted by a prior run. Called once at startup with the
  // on-disk path, which is then reused for subsequent writes.
  restore(path: string): void {
    this.persistPath = path
    try {
      const snap = JSON.parse(readFileSync(path, 'utf8')) as UsageSnapshot
      if (snap && Array.isArray(snap.windows)) this.current = snap
    } catch {
      // No file yet (first run) or unreadable — start empty.
    }
  }

  // Full snapshot from a `/usage` poll (session + weekly windows).
  updateFromPoll(windows: UsageWindow[], now: number): void {
    this.current = { windows, fetchedAt: now, source: 'poll' }
    this.persist()
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
    this.persist()
    this.emit()
  }

  snapshot(): UsageSnapshot | null {
    return this.current
  }

  private persist(): void {
    if (!this.persistPath || !this.current) return
    try {
      writeFileSync(this.persistPath, JSON.stringify(this.current))
    } catch (error) {
      logger.debug('Subscription usage persist failed', error)
    }
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
