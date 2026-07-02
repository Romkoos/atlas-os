import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export interface ChatEntry {
  kind: 'assistant' | 'tool' | 'user'
  text: string
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
  reattach: () => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
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
export function createChatRunStore(key: string) {
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
        reattach: () => set({ running: true }),
        appendToken: (text) => set((s) => ({ streaming: s.streaming + text, awaitingInput: false })),
        flushTurn: () =>
          set((s) => {
            const text = s.streaming.trimEnd()
            return text.trim()
              ? { transcript: [...s.transcript, { kind: 'assistant', text }], streaming: '' }
              : { streaming: '' }
          }),
        pushTool: (summary) =>
          set((s) => ({ transcript: [...s.transcript, { kind: 'tool', text: summary }] })),
        pushUserReply: (text) =>
          set((s) => ({
            transcript: [...s.transcript, { kind: 'user', text }],
            awaitingInput: false,
          })),
        setAwaiting: (v) => set({ awaitingInput: v, status: v ? 'awaiting' : 'running' }),
        bumpSeq: (seq) => set((s) => ({ lastSeq: Math.max(s.lastSeq, seq) })),
        finish: (status) => set({ running: false, awaitingInput: false, status }),
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
