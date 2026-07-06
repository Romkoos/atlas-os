import { recordSignal } from '@main/services/signals/registry'
import type { RateLimitInfo, SeqEnvelope } from '@shared/ipc-events'
import type { ResumableRun } from './resumableRun'
import {
  classifyStop,
  continuationPrompt,
  nextAutoContinueDelayMs,
  shouldStopAutoContinue,
} from './stopClassifier'

const BUFFER_CAP = 4000 // envelopes; bounds gap-replay depth, not the on-disk transcript

type Subscriber = (env: SeqEnvelope<unknown>) => void
type Status = 'running' | 'awaiting' | 'limited' | 'done' | 'error'

interface SessionRecord {
  sessionId: string
  run: ResumableRun
  buffer: SeqEnvelope<unknown>[]
  nextSeq: number
  status: Status
  subscriber: Subscriber | null
  // Durable-run state.
  resumable: boolean
  continuationKind: 'worker' | 'plain'
  buildRun: OpenParams['buildRun']
  userCancelled: boolean
  noProgressCount: number // consecutive unexpected/rate-limited stops with no new activity since the last one
  attempt: number // total auto-continues, for backoff
  lastRateLimit: RateLimitInfo | null
  limitTimer: ReturnType<typeof setTimeout> | null
}

export interface OpenParams {
  sessionId: string
  lastSeq: number
  kickoff?: string
  resumable: boolean
  // On a reattach with no kickoff: if true, auto-continue the interrupted work
  // (persisted status was 'running'); if false/absent, resume-and-idle.
  continueWork?: boolean
  continuationKind: 'worker' | 'plain'
  buildRun: (args: {
    resume: boolean
    kickoff?: string
    resumeMessage?: string
    push: (event: unknown) => void
  }) => ResumableRun
}

function isProgress(event: unknown): boolean {
  const type = (event as { type?: string }).type
  return type === 'token' || type === 'tool' || type === 'tool-result'
}

export class ChatSessionRegistry {
  private records = new Map<string, SessionRecord>()

  open(params: OpenParams, emit: Subscriber): () => void {
    const existing = this.records.get(params.sessionId)
    if (existing) {
      existing.subscriber = emit
      for (const env of existing.buffer) if (env.seq > params.lastSeq) emit(env)
      return () => {
        if (existing.subscriber === emit) existing.subscriber = null
      }
    }

    // No live record. A brand-new session has a kickoff; otherwise resume from disk.
    const resume = params.kickoff === undefined
    if (resume && !params.resumable) {
      // Non-resumable type after an app restart: the session is dead. Report it ended.
      emit({ seq: 1, event: { type: 'aborted' } })
      return () => {}
    }

    const record: SessionRecord = {
      sessionId: params.sessionId,
      run: undefined as unknown as ResumableRun,
      buffer: [],
      nextSeq: 1,
      status: 'running',
      subscriber: emit,
      resumable: params.resumable,
      continuationKind: params.continuationKind,
      buildRun: params.buildRun,
      userCancelled: false,
      noProgressCount: 0,
      attempt: 0,
      lastRateLimit: null,
      limitTimer: null,
    }
    this.records.set(params.sessionId, record)

    const push = (event: unknown) => this.handle(record, event)

    // Reattach that should continue work → resume WITH a continuation turn.
    const resumeMessage =
      resume && params.continueWork ? continuationPrompt(record.continuationKind) : undefined

    record.run = params.buildRun({ resume, kickoff: params.kickoff, resumeMessage, push })
    return () => {
      if (record.subscriber === emit) record.subscriber = null
    }
  }

  // Central event handler: decides what (if anything) to forward to the client
  // and whether a stop should finalize, idle, or auto-continue. Deliberately does
  // NOT forward the raw error/aborted event that triggers an auto-continue — the
  // client treats a forwarded error/aborted as terminal (red toast + error status),
  // which would fire on every smooth retry. Only a give-up emits a terminal error.
  private handle(record: SessionRecord, event: unknown): void {
    const type = (event as { type?: string }).type

    if (isProgress(event)) {
      this.subscriberEmit(record, event)
      record.status = 'running'
      record.noProgressCount = 0 // real work happened; reset the guard
      return
    }

    if (type === 'rate-limit') {
      record.lastRateLimit = event as RateLimitInfo
      this.subscriberEmit(record, event) // gauge/limited display needs it
      if ((event as RateLimitInfo).status !== 'rejected') return
      // rejected → fall through to stop handling below
    } else if (type === 'reconnecting') {
      this.subscriberEmit(record, event)
      return
    } else if (type === 'awaiting-input') {
      this.subscriberEmit(record, event)
      record.status = 'awaiting'
      record.noProgressCount = 0
      return
    } else if (type === 'done') {
      this.subscriberEmit(record, event)
      this.finalize(record, event)
      return
    }

    // A rate-limit rejection already scheduled a reset-timed resume; the SDK also
    // emits a trailing non-success result (error) for the same turn — absorb it so
    // it can't cancel the reset timer and retry immediately.
    if (record.status === 'limited' && record.limitTimer !== null && type === 'error') return

    const kind = classifyStop(event as { type: string; status?: string }, record.userCancelled)
    if (kind === 'clean') {
      this.subscriberEmit(record, event)
      if (type === 'aborted') this.finalize(record, event)
      return
    }

    // unexpected | rate-limited → auto-continue unless the guard is tripped. Count
    // *this* stop toward the no-progress streak before deciding (not inside
    // autoContinue()) so the cap trips on the Nth stop itself, not the (N+1)th.
    record.noProgressCount += 1

    // Terminal short-circuits — do NOT schedule an auto-continue when:
    //  - the session type is non-resumable (e.g. the skill improver): buildRun's
    //    args require a kickoff that only exists on the first open, so a rebuild
    //    would crash;
    //  - an unexpected error arrived while cleanly awaiting the user (idle): the
    //    connection died with nothing in flight, so injecting a "continue where
    //    you left off" turn would be spurious;
    //  - the loop-guard cap of consecutive no-progress retries is reached.
    // All three forward a terminal error and finalize. (The rate-limited
    // scheduling path below is intentionally left untouched.)
    if (
      !record.resumable ||
      (kind === 'unexpected' && record.status === 'awaiting') ||
      shouldStopAutoContinue(record.noProgressCount)
    ) {
      const message = !record.resumable
        ? 'Chat run failed and cannot be resumed'
        : kind === 'unexpected' && record.status === 'awaiting'
          ? 'Chat connection lost'
          : 'Auto-continue gave up after repeated failures'
      this.subscriberEmit(record, { type: 'error', message })
      // Persist the terminal failure to the Signals log. Defensive recordSignal:
      // a db-less unit-test env is a no-op, never a throw.
      recordSignal({
        source: 'chat',
        type: 'chat.error',
        severity: 'error',
        title: 'Chat run failed',
        detail: message,
      })
      this.finalize(record, event)
      return
    }

    const now = Date.now()
    // Rate-limited stops always wait for the subscription window (resetsAt, or
    // exponential backoff if the SDK didn't report one). Unexpected stops (dead
    // stream, stall, non-user abort) retry immediately — they rely on the SDK's
    // own api_retry backoff plus the noProgressCount cap above to bound the loop,
    // so an artificial delay here buys nothing.
    const delayMs =
      kind === 'rate-limited'
        ? nextAutoContinueDelayMs({
            resetsAt: record.lastRateLimit?.resetsAt,
            now,
            attempt: record.attempt,
          })
        : 0

    if (kind === 'rate-limited') {
      record.status = 'limited'
      this.subscriberEmit(record, {
        type: 'limited',
        resetsAt: record.lastRateLimit?.resetsAt,
        rateLimitType: record.lastRateLimit?.rateLimitType,
        resumesInMs: delayMs,
      })
    }

    if (record.limitTimer) clearTimeout(record.limitTimer)
    if (delayMs <= 0) this.autoContinue(record)
    else record.limitTimer = setTimeout(() => this.autoContinue(record), delayMs)
  }

  private autoContinue(record: SessionRecord): void {
    if (!this.records.has(record.sessionId)) return
    // A non-resumable session type cannot be rebuilt (its buildRun needs a kickoff
    // that only exists on the first open) — never auto-continue it.
    if (!record.resumable) return
    // The reset/backoff timer (if any) has fired by the time we get here; null it
    // so a stale non-null handle can't later mis-trigger the absorb-trailing-error
    // guard in handle() once status leaves 'limited'.
    record.limitTimer = null
    // Silently tear down the superseded run's SDK child process before it is
    // overwritten below — otherwise it stays parked on its mailbox forever.
    record.run?.dispose()
    record.attempt += 1 // noProgressCount was already bumped in handle() for this stop
    record.status = 'running'
    this.subscriberEmit(record, { type: 'resuming', attempt: record.attempt })
    record.run = record.buildRun({
      resume: true,
      resumeMessage: continuationPrompt(record.continuationKind),
      push: (event: unknown) => this.handle(record, event),
    })
  }

  // Single buffering helper for every client-facing emit (buffer + seq + subscriber).
  private subscriberEmit(record: SessionRecord, event: unknown): void {
    const env: SeqEnvelope<unknown> = { seq: record.nextSeq++, event }
    record.buffer.push(env)
    if (record.buffer.length > BUFFER_CAP) record.buffer.shift()
    record.subscriber?.(env)
  }

  private finalize(record: SessionRecord, _event: unknown): void {
    if (record.limitTimer) clearTimeout(record.limitTimer)
    // Silent teardown of the live run's SDK child process before dropping the
    // record (no `aborted` emit — the terminal event was already forwarded).
    record.run?.dispose()
    this.records.delete(record.sessionId)
  }

  reply(sessionId: string, text: string): boolean {
    const record = this.records.get(sessionId)
    record?.run.reply(text)
    return Boolean(record)
  }

  // Called on OS wake: a run that was mid-turn when the machine slept may have a
  // dead stream that has not yet tripped the 90s watchdog. autoContinue() already
  // disposes the superseded run silently before rebuilding, so no separate
  // cancel() here — calling cancel() first would also emit a spurious `aborted`
  // that re-enters handle() and could double-trigger the continuation.
  nudgeStalled(): void {
    for (const record of this.records.values()) {
      if (record.status === 'running' && record.resumable) this.autoContinue(record)
    }
  }

  cancel(sessionId: string): boolean {
    const record = this.records.get(sessionId)
    if (record) {
      record.userCancelled = true
      if (record.limitTimer) clearTimeout(record.limitTimer)
    }
    record?.run.cancel()
    this.records.delete(sessionId)
    return Boolean(record)
  }
}

export const chatRegistry = new ChatSessionRegistry()
