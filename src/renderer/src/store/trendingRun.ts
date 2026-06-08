import { create } from 'zustand'

// GitHub-trending run state lives OUTSIDE the News page so a run survives tab
// switches. The subscription is hosted at the App level (always mounted); the
// page only reads/writes this store. Mirrors newsRun.ts.
interface TrendingRunState {
  running: boolean
  output: string
  requestId: string | null
  start: () => void
  cancel: () => void
  appendToken: (text: string) => void
  finish: () => void
}

export const useTrendingRun = create<TrendingRunState>((set) => ({
  running: false,
  output: '',
  requestId: null,
  start: () => set({ running: true, output: '', requestId: crypto.randomUUID() }),
  // Flipping `running` off switches the subscription input to skipToken, which
  // unsubscribes → the main-side run is aborted in the observable teardown.
  cancel: () => set({ running: false }),
  appendToken: (text) => set((s) => ({ output: s.output + text })),
  finish: () => set({ running: false }),
}))
