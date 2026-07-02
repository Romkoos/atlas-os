import type { SeqEnvelope } from '@shared/ipc-events'
import type { ResumableRun } from './resumableRun'

const BUFFER_CAP = 4000 // envelopes; bounds gap-replay depth, not the on-disk transcript

type Subscriber = (env: SeqEnvelope<unknown>) => void
type Status = 'running' | 'awaiting' | 'done' | 'error'

interface SessionRecord {
  sessionId: string
  run: ResumableRun
  buffer: SeqEnvelope<unknown>[]
  nextSeq: number
  status: Status
  subscriber: Subscriber | null
}

export interface OpenParams {
  sessionId: string
  lastSeq: number
  kickoff?: string
  resumable: boolean
  buildRun: (args: {
    resume: boolean
    kickoff?: string
    push: (event: unknown) => void
  }) => ResumableRun
}

function nextStatus(event: unknown, prev: Status): Status {
  const type = (event as { type?: string }).type
  if (type === 'awaiting-input') return 'awaiting'
  if (type === 'error') return 'error'
  if (type === 'done' || type === 'aborted') return 'done'
  return prev === 'awaiting' ? 'running' : prev
}

function isTerminal(event: unknown): boolean {
  const type = (event as { type?: string }).type
  return type === 'aborted' || type === 'error' || type === 'done'
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
    }
    this.records.set(params.sessionId, record)

    const push = (event: unknown) => {
      const env: SeqEnvelope<unknown> = { seq: record.nextSeq++, event }
      record.buffer.push(env)
      if (record.buffer.length > BUFFER_CAP) record.buffer.shift()
      record.status = nextStatus(event, record.status)
      record.subscriber?.(env)
      if (isTerminal(event)) this.records.delete(params.sessionId)
    }

    record.run = params.buildRun({ resume, kickoff: params.kickoff, push })
    return () => {
      if (record.subscriber === emit) record.subscriber = null
    }
  }

  reply(sessionId: string, text: string): boolean {
    const record = this.records.get(sessionId)
    record?.run.reply(text)
    return Boolean(record)
  }

  cancel(sessionId: string): boolean {
    const record = this.records.get(sessionId)
    record?.run.cancel()
    this.records.delete(sessionId)
    return Boolean(record)
  }
}

export const chatRegistry = new ChatSessionRegistry()
