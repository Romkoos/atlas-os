import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { recordSignal } from '@main/services/signals/registry'
import type { JobStatus, JobsSnapshot, JobView } from '@shared/jobs'

// Keep the last N completed jobs (in-memory; lost on restart).
const MAX_RECENT = 10

export interface RegisterOptions {
  kind: string
  label: string
  // When present, the job is cancellable and the registry can route cancel(id)
  // to this callback. Absent → the UI shows no abort button.
  abort?: () => void
  model?: string | null
  detail?: string | null
}

export interface FinishMeta {
  tokens?: number | null
  resultPath?: string | null
  error?: string | null
  detail?: string | null
}

export interface JobHandle {
  id: string
  // Push live progress on a running job (e.g. benchmark done/total · phase).
  update(patch: { detail?: string | null; tokens?: number | null }): void
  finish(status: 'done' | 'error', meta?: FinishMeta): void
}

interface ActiveJob {
  id: string
  kind: string
  label: string
  startedAt: number
  abort?: () => void
  model: string | null
  detail: string | null
  tokens: number | null
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
      model: opts.model ?? null,
      detail: opts.detail ?? null,
      tokens: null,
    })
    this.emit('change')
    let finished = false
    return {
      id,
      update: (patch) => {
        if (finished) return
        const job = this.active.get(id)
        if (!job) return
        if (patch.detail !== undefined) job.detail = patch.detail
        if (patch.tokens !== undefined) job.tokens = patch.tokens
        this.emit('change')
      },
      finish: (status, meta) => {
        if (finished) return
        finished = true
        this.complete(id, status, meta)
      },
    }
  }

  private complete(id: string, status: JobStatus, meta?: FinishMeta): void {
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
      model: job.model,
      detail: meta?.detail ?? job.detail,
      tokens: meta?.tokens ?? job.tokens,
      resultPath: meta?.resultPath ?? null,
      error: meta?.error ?? null,
    })
    if (this.recent.length > MAX_RECENT) this.recent.length = MAX_RECENT
    this.emit('change')
    this.recordSignal(status, meta, job)
  }

  // Land a finished job in the Signals event log. `benchmark` batches emit their
  // own richer batch-level signal (done/failed counts), so they're skipped here
  // to avoid a duplicate. recordSignal is defensive — a db-less test env is a
  // no-op, never a throw.
  private recordSignal(status: JobStatus, meta: FinishMeta | undefined, job: ActiveJob): void {
    if (job.kind === 'benchmark') return
    const resultPath = meta?.resultPath ?? null
    recordSignal({
      source: 'jobs',
      type: status === 'done' ? 'job.completed' : 'job.failed',
      severity: status === 'done' ? 'success' : 'error',
      title: status === 'done' ? job.label : `${job.label} failed`,
      detail: meta?.error ?? meta?.detail ?? job.detail,
      link: resultPath,
      linkKind: resultPath ? 'path' : null,
    })
  }

  // Fires the abort callback only; the job is not removed from active here. The
  // process's terminal signal (promise rejection or terminal event) later calls
  // finish('error'), which moves the job to recent and emits 'change'.
  cancel(id: string): boolean {
    const job = this.active.get(id)
    if (!job?.abort) return false
    job.abort()
    return true
  }

  // Resolve a recorded output path for a recent job (active jobs have no result
  // yet). Returns null for unknown ids — the reveal mutation guards on this so
  // the renderer can never reveal an arbitrary path.
  getResultPath(id: string): string | null {
    return this.recent.find((j) => j.id === id)?.resultPath ?? null
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
      model: j.model,
      detail: j.detail,
      tokens: j.tokens,
      resultPath: null,
      error: null,
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
// `trackJob(...).catch(() => {})`. `mapResult` turns the resolved value into
// finish meta (tokens/resultPath/detail); rejection records the error message.
export async function trackJob<T>(
  reg: JobRegistry,
  opts: RegisterOptions,
  work: Promise<T>,
  mapResult?: (r: T) => FinishMeta,
): Promise<T> {
  const job = reg.register(opts)
  try {
    const result = await work
    job.finish('done', mapResult ? mapResult(result) : undefined)
    return result
  } catch (err) {
    job.finish('error', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }
}
