import type { ClaudeModelId } from '@shared/models'
import type { TimelineEvent } from '@shared/timeline'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ChatEntry =
  | { kind: 'assistant' | 'user'; text: string }
  | {
      kind: 'tool'
      text: string
      id: string
      name: string
      status: 'running' | 'done' | 'error'
      resultText?: string
    }
export type ChatStatus =
  | 'idle'
  | 'running'
  | 'awaiting'
  | 'reconnecting'
  | 'limited'
  | 'done'
  | 'error'
  | 'aborted'

export interface BaseChatRunState {
  sessionId: string | null
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  status: ChatStatus
  lastSeq: number
  // Non-persisted log of enriched timeline events for the live waterfall. Not
  // persisted: after an app restart it is empty, so the Timeline tab falls back
  // to the on-disk transcript (replay).
  timelineEvents: TimelineEvent[]
  // True only for a session started fresh in this app session; false after a
  // reattach/restart, so the Timeline view prefers the complete on-disk
  // transcript over the partial live buffer.
  freshStart: boolean
  running: boolean
  // Model chosen for this chat. null = fall back to the global default model.
  // Fixed for the life of a session (captured at start / reused on reattach).
  model: ClaudeModelId | null
  // Autonomous end-to-end mode (worker chat only). When true the session's seed
  // authorizes commit/push/merge/deploy without confirmation. Fixed for the life
  // of the session, exactly like `model`. Default false; other chat types never
  // set it true.
  autonomous: boolean
  start: (message: string, model?: ClaudeModelId | null, autonomous?: boolean) => void
  startBlank: (model?: ClaudeModelId | null) => void
  reattach: () => void
  appendToken: (text: string) => void
  pushTool: (id: string, name: string, summary: string) => void
  resolveTool: (id: string, resultText: string, isError: boolean) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  setReconnecting: () => void
  setLimited: (resumesInMs?: number) => void
  setResuming: () => void
  bumpSeq: (seq: number) => void
  pushTimelineEvent: (ev: TimelineEvent) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

// Guarded storage: a no-op in-memory store when DOM localStorage is absent, so
// importing this module under Vitest's node environment does not throw.
const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
}

type Persisted = Pick<
  BaseChatRunState,
  'sessionId' | 'transcript' | 'status' | 'awaitingInput' | 'lastSeq' | 'model' | 'autonomous'
>

// Builds a persisted zustand store for one chat type. `running` (transient) and
// `streaming` (partial) are deliberately NOT persisted — ChatHost decides on
// mount whether to reattach a persisted running/awaiting session.
export interface ChatRunStoreOptions {
  // Transform the accumulated streamed text before it is committed as an
  // assistant transcript entry (e.g. strip a report sentinel). Defaults to identity.
  sanitizeStreaming?: (text: string) => string
}

// A turn/run boundary can arrive with a tool still marked `running` (its
// tool_result never surfaced). Sweep those to `done` so no spinner sticks.
function settleTools(transcript: ChatEntry[]): ChatEntry[] {
  return transcript.map((e) =>
    e.kind === 'tool' && e.status === 'running' ? { ...e, status: 'done' } : e,
  )
}

export function createChatRunStore(key: string, opts: ChatRunStoreOptions = {}) {
  const sanitize = opts.sanitizeStreaming ?? ((t: string) => t)
  const storage = createJSONStorage<Persisted>(() =>
    typeof localStorage !== 'undefined' ? localStorage : noopStorage,
  )
  return create<BaseChatRunState>()(
    persist(
      (set) => ({
        sessionId: null,
        transcript: [],
        streaming: '',
        awaitingInput: false,
        status: 'idle',
        lastSeq: 0,
        timelineEvents: [],
        freshStart: false,
        running: false,
        model: null,
        autonomous: false,
        start: (message, model, autonomous) =>
          set((s) => ({
            sessionId: crypto.randomUUID(),
            transcript: [{ kind: 'user', text: message }],
            streaming: '',
            awaitingInput: false,
            status: 'running',
            lastSeq: 0,
            timelineEvents: [],
            freshStart: true,
            running: true,
            model: model !== undefined ? model : s.model,
            autonomous: autonomous !== undefined ? autonomous : s.autonomous,
          })),
        // For chats whose kickoff is not a user-visible message (benchmark
        // batchId, improver skillId): mint the session with an empty transcript.
        startBlank: (model) =>
          set((s) => ({
            sessionId: crypto.randomUUID(),
            transcript: [],
            streaming: '',
            awaitingInput: false,
            status: 'running',
            lastSeq: 0,
            timelineEvents: [],
            freshStart: true,
            running: true,
            model: model !== undefined ? model : s.model,
          })),
        reattach: () => set({ running: true, freshStart: false }),
        appendToken: (text) =>
          set((s) => ({ streaming: s.streaming + text, awaitingInput: false })),
        flushTurn: () =>
          set((s) => {
            const text = sanitize(s.streaming).trimEnd()
            const swept = settleTools(s.transcript)
            return text.trim()
              ? { transcript: [...swept, { kind: 'assistant', text }], streaming: '' }
              : { transcript: swept, streaming: '' }
          }),
        pushTool: (id, name, summary) =>
          set((s) => ({
            transcript: [
              ...s.transcript,
              { kind: 'tool', id, name, text: summary, status: 'running' },
            ],
          })),
        resolveTool: (id, resultText, isError) =>
          set((s) => ({
            transcript: s.transcript.map((e) =>
              e.kind === 'tool' && e.id === id
                ? { ...e, status: isError ? 'error' : 'done', resultText }
                : e,
            ),
          })),
        pushUserReply: (text) =>
          set((s) => ({
            transcript: [...s.transcript, { kind: 'user', text }],
            awaitingInput: false,
          })),
        setAwaiting: (v) => set({ awaitingInput: v, status: v ? 'awaiting' : 'running' }),
        setReconnecting: () => set({ status: 'reconnecting', awaitingInput: false, running: true }),
        setLimited: () => set({ status: 'limited', awaitingInput: false, running: true }),
        setResuming: () => set({ status: 'running', awaitingInput: false, running: true }),
        bumpSeq: (seq) => set((s) => ({ lastSeq: Math.max(s.lastSeq, seq) })),
        pushTimelineEvent: (ev) => set((s) => ({ timelineEvents: [...s.timelineEvents, ev] })),
        finish: (status) =>
          set((s) => ({
            running: false,
            awaitingInput: false,
            status,
            transcript: settleTools(s.transcript),
          })),
        reset: () =>
          set({
            sessionId: null,
            transcript: [],
            streaming: '',
            awaitingInput: false,
            status: 'idle',
            lastSeq: 0,
            timelineEvents: [],
            freshStart: false,
            running: false,
            model: null,
            autonomous: false,
          }),
      }),
      {
        name: key,
        version: 2,
        storage,
        // v1 → v2 added `autonomous`; old persisted sessions default to false so
        // a resumed pre-feature session is never silently autonomous.
        migrate: (persisted, version) => {
          const p = (persisted ?? {}) as Partial<Persisted>
          if (version < 2) return { ...p, autonomous: false } as Persisted
          return p as Persisted
        },
        partialize: (s): Persisted => ({
          sessionId: s.sessionId,
          transcript: s.transcript,
          status: s.status,
          awaitingInput: s.awaitingInput,
          lastSeq: s.lastSeq,
          model: s.model,
          autonomous: s.autonomous,
        }),
      },
    ),
  )
}
