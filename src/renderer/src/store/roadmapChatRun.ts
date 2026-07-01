import type { RoadmapItem } from '@shared/roadmap'
import { create } from 'zustand'

export interface RoadmapChatEntry {
  kind: 'assistant' | 'tool' | 'user'
  text: string
}

// Lives OUTSIDE the Roadmap page so the brainstorming session survives tab
// switches; the subscription is hosted at App level (RoadmapChatHost).
interface RoadmapChatState {
  running: boolean
  requestId: string | null
  idea: string | null
  transcript: RoadmapChatEntry[]
  streaming: string
  awaitingInput: boolean
  savedItem: RoadmapItem | null
  status: 'idle' | 'running' | 'done' | 'error' | 'aborted'

  start: (idea: string) => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  setSaved: (item: RoadmapItem) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

export const useRoadmapChatRun = create<RoadmapChatState>((set) => ({
  running: false,
  requestId: null,
  idea: null,
  transcript: [],
  streaming: '',
  awaitingInput: false,
  savedItem: null,
  status: 'idle',

  start: (idea) =>
    set({
      running: true,
      requestId: crypto.randomUUID(),
      idea,
      transcript: [{ kind: 'user', text: idea }],
      streaming: '',
      awaitingInput: false,
      savedItem: null,
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

  setSaved: (item) => set({ savedItem: item }),

  finish: (status) => set({ running: false, awaitingInput: false, status }),

  reset: () =>
    set({
      running: false,
      requestId: null,
      idea: null,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      savedItem: null,
      status: 'idle',
    }),
}))
