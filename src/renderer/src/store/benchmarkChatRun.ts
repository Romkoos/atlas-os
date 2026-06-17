import { create } from 'zustand'

export interface ChatEntry {
  kind: 'assistant' | 'tool' | 'user'
  text: string
}

// Lives OUTSIDE the Productivity page so the session survives tab switches; the
// subscription is hosted at App level (BenchmarkChatHost).
interface BenchmarkChatState {
  running: boolean
  requestId: string | null
  batchId: string | null
  transcript: ChatEntry[]
  streaming: string
  awaitingInput: boolean
  status: 'idle' | 'running' | 'done' | 'error' | 'aborted'

  start: (batchId: string) => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

export const useBenchmarkChatRun = create<BenchmarkChatState>((set) => ({
  running: false,
  requestId: null,
  batchId: null,
  transcript: [],
  streaming: '',
  awaitingInput: false,
  status: 'idle',

  start: (batchId) =>
    set({
      running: true,
      requestId: crypto.randomUUID(),
      batchId,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      status: 'running',
    }),

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

  setAwaiting: (v) => set({ awaitingInput: v }),

  finish: (status) => set({ running: false, awaitingInput: false, status }),

  reset: () =>
    set({
      running: false,
      requestId: null,
      batchId: null,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      status: 'idle',
    }),
}))
