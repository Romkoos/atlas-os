import { type ImproverReport, REPORT_SENTINEL } from '@shared/skillImprover'
import { create } from 'zustand'

export interface TranscriptEntry {
  kind: 'assistant' | 'tool' | 'user'
  text: string
}

// Improver-run state lives OUTSIDE the Skills page so a session survives tab
// switches. The subscription is hosted at the App level (SkillImproverHost);
// the page only reads/writes this store.
interface ImproverRunState {
  running: boolean
  requestId: string | null
  skillId: string | null
  transcript: TranscriptEntry[]
  streaming: string // text accumulating for the in-progress assistant turn
  awaitingInput: boolean
  report: ImproverReport | null
  status: 'idle' | 'running' | 'reviewing' | 'done' | 'error' | 'aborted'

  start: (skillId: string) => void
  appendToken: (text: string) => void
  pushTool: (summary: string) => void
  pushUserReply: (text: string) => void
  flushTurn: () => void
  setAwaiting: (v: boolean) => void
  setReport: (report: ImproverReport) => void
  finish: (status: 'done' | 'error' | 'aborted') => void
  reset: () => void
}

export const useSkillImproverRun = create<ImproverRunState>((set) => ({
  running: false,
  requestId: null,
  skillId: null,
  transcript: [],
  streaming: '',
  awaitingInput: false,
  report: null,
  status: 'idle',

  start: (skillId) =>
    set({
      running: true,
      requestId: crypto.randomUUID(),
      skillId,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      report: null,
      status: 'running',
    }),

  appendToken: (text) => set((s) => ({ streaming: s.streaming + text, awaitingInput: false })),

  // Commit the streamed assistant text as a transcript entry (called at turn
  // end). Strip the report sentinel so the raw token never shows in the chat —
  // the rendered report replaces it.
  flushTurn: () =>
    set((s) => {
      const text = s.streaming.split(REPORT_SENTINEL).join('').trimEnd()
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

  setReport: (report) => set({ report, status: 'reviewing' }),

  finish: (status) => set({ running: false, awaitingInput: false, status }),

  reset: () =>
    set({
      running: false,
      requestId: null,
      skillId: null,
      transcript: [],
      streaming: '',
      awaitingInput: false,
      report: null,
      status: 'idle',
    }),
}))
