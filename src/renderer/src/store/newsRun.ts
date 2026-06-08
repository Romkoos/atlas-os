import { create } from 'zustand'

// News-run state lives OUTSIDE the News page so a run survives tab switches.
// The subscription is hosted at the App level (always mounted); the page only
// reads/writes this store. Unmounting News no longer tears down the run.
interface NewsRunState {
  running: boolean
  output: string
  requestId: string | null
  start: () => void
  cancel: () => void
  appendToken: (text: string) => void
  finish: () => void
}

export const useNewsRun = create<NewsRunState>((set) => ({
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
