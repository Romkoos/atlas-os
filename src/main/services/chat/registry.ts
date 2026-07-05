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
  continuationKind: 'worker' | 'plain'
  buildRun: OpenParams['buildRun']
  userCancelled: boolean
  noProgressCount: number // consecutive unexpected/rate-limited stops with no new activity since
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
    if (shouldStopAutoContinue(record.noProgressCount)) {
      this.subscriberEmit(record, {
        type: 'error',
        message: 'Auto-continue gave up after repeated failures',
      })
      this.finalize(record, event)
      return
    }

    const now = Date.now()
    // Rate-limited stops always wait for the subscription window (resetsAt, or
    // exponential backoff if the SDK didn't report one). Unexpected stops (dead
    // stream, stall, non-user abort) retry immediately — the noProgressCount cap
    // above is what bounds the loop, not a timer; an artificial backoff here
    // buys nothing since these are one-shot connection hiccups, not a shared
    // rate budget.
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
    this.records.delete(record.sessionId)
  }

  reply(sessionId: string, text: string): boolean {
    const record = this.records.get(sessionId)
    record?.run.reply(text)
    return Boolean(record)
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
