import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type { JobStatus, JobsSnapshot, JobView } from '@shared/jobs'

// Keep the last N completed jobs in the hover list (in-memory; lost on restart).
const MAX_RECENT = 10

export interface RegisterOptions {
  kind: string
  label: string
  // When present, the job is cancellable and the registry can route cancel(id)
  // to this callback. Absent → the UI shows no abort button.
  abort?: () => void
}

export interface JobHandle {
  id: string
  finish(status: 'done' | 'error'): void
}

interface ActiveJob {
  id: string
  kind: string
  label: string
  startedAt: number
  abort?: () => void
}

// Single source of truth for "what Atlas processes are running". Every process
// registers here; the jobs tRPC router streams snapshot() on every 'change'.
export class JobRegistry extends EventEmitter {
  private active = new Map<string, ActiveJob>()
  private recent: JobView[] = []

  register(opts: RegisterOptions): JobHandle {
    const id = randomUUID()
    this.active.set(id, {
      id,
      kind: opts.kind,
      label: opts.label,
      startedAt: Date.now(),
      abort: opts.abort,
    })
    this.emit('change')
    let finished = false
    return {
      id,
      finish: (status) => {
        if (finished) return
        finished = true
        this.complete(id, status)
      },
    }
  }

  private complete(id: string, status: JobStatus): void {
    const job = this.active.get(id)
    if (!job) return
    this.active.delete(id)
    this.recent.unshift({
      id: job.id,
      kind: job.kind,
      label: job.label,
      status,
      startedAt: job.startedAt,
      endedAt: Date.now(),
      cancellable: false,
    })
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT
    this.emit('change')
  }

  cancel(id: string): boolean {
    const job = this.active.get(id)
    if (!job?.abort) return false
    job.abort()
    return true
  }

  snapshot(): JobsSnapshot {
    const running: JobView[] = [...this.active.values()].map((j) => ({
      id: j.id,
      kind: j.kind,
      label: j.label,
      status: 'running' as const,
      startedAt: j.startedAt,
      endedAt: null,
      cancellable: Boolean(j.abort),
    }))
    return { running, recent: [...this.recent] }
  }

  onChange(listener: () => void): () => void {
    this.on('change', listener)
    return () => this.off('change', listener)
  }
}

// App-wide singleton: every process registers here.
export const jobRegistry = new JobRegistry()

// Track an existing promise as a job: register, await, finish done/error, and
// re-throw so awaiting callers (mutations) still surface failures. Fire-and-forget
// callers (subscriptions that already handle their own promise) should write
// `trackJob(...).catch(() => {})`.
export async function trackJob<T>(
  reg: JobRegistry,
  opts: RegisterOptions,
  work: Promise<T>,
): Promise<T> {
  const job = reg.register(opts)
  try {
    const result = await work
    job.finish('done')
    return result
  } catch (err) {
    job.finish('error')
    throw err
  }
}
