import type { RebuildEvent, RebuildState } from '@shared/rebuild'
import { create } from 'zustand'

// Mirror of the main-side rebuildRun, fed by the rebuild.stream subscription in
// RebuildRunHost. Lives at App level so the modal + log survive tab switches.
interface RebuildRunState {
  open: boolean
  state: RebuildState
  log: string[]
  setOpen: (open: boolean) => void
  // Clear before kicking off a fresh run (the persistent subscription won't
  // replay — it only forwards new emissions).
  reset: () => void
  applyEvent: (event: RebuildEvent) => void
}

export const useRebuildRun = create<RebuildRunState>((set) => ({
  open: false,
  state: 'idle',
  log: [],
  setOpen: (open) => set({ open }),
  reset: () => set({ state: 'running', log: [] }),
  applyEvent: (event) =>
    set((s) => ({
      state: event.state,
      log: event.line !== undefined ? [...s.log, event.line] : s.log,
    })),
}))
