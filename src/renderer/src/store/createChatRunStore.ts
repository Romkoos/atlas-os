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
export type ChatStatus = 'idle' | 'running' | 'awaiting' | 'done' | 'error' | 'aborted'

export interface BaseChatRunState {
  sessionId: string | null
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  status: ChatStatus
  lastSeq: number
  running: boolean
  start: (message: string) => void
  startBlank: () => void
  reattach: () => void
  appendToken: (text: string) => void
  pushTool: (id: string, name: string, summary: string) => void
  resolveTool: (id: string, resultText: string, isError: boolean) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  bumpSeq: (seq: number) => void
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
  'sessionId' | 'transcript' | 'status' | 'awaitingInput' | 'lastSeq'
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
        running: false,
        start: (message) =>
          set({
            sessionId: crypto.randomUUID(),
            transcript: [{ kind: 'user', text: message }],
            streaming: '',
            awaitingInput: false,
            status: 'running',
            lastSeq: 0,
            running: true,
          }),
        // For chats whose kickoff is not a user-visible message (benchmark
        // batchId, improver skillId): mint the session with an empty transcript.
        startBlank: () =>
          set({
            sessionId: crypto.randomUUID(),
            transcript: [],
            streaming: '',
            awaitingInput: false,
            status: 'running',
            lastSeq: 0,
            running: true,
          }),
        reattach: () => set({ running: true }),
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
        bumpSeq: (seq) => set((s) => ({ lastSeq: Math.max(s.lastSeq, seq) })),
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
            running: false,
          }),
      }),
      {
        name: key,
        version: 1,
        storage,
        partialize: (s): Persisted => ({
          sessionId: s.sessionId,
          transcript: s.transcript,
          status: s.status,
          awaitingInput: s.awaitingInput,
          lastSeq: s.lastSeq,
        }),
      },
    ),
  )
}
