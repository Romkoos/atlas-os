import { create } from 'zustand'

export interface GeneralChatEntry {
  kind: 'assistant' | 'tool' | 'user'
  text: string
}

// Lives OUTSIDE any page so the chat survives tab switches; the subscription is
// hosted at App level (GeneralChatHost).
interface GeneralChatState {
  running: boolean
  requestId: string | null
  message: string | null
  transcript: GeneralChatEntry[]
  streaming: string
  awaitingInput: boolean
  status: 'idle' | 'running' | 'done' | 'error' | 'aborted'

  start: (message: string) => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

export const useGeneralChatRun = create<GeneralChatState>((set) => ({
  running: false,
  requestId: null,
  message: null,
  transcript: [],
  streaming: '',
  awaitingInput: false,
  status: 'idle',

  start: (message) =>
    set({
      running: true,
      requestId: crypto.randomUUID(),
      message,
      transcript: [{ kind: 'user', text: message }],
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
      message: null,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      status: 'idle',
    }),
}))
