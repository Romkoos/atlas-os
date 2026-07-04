import { create } from 'zustand'

// Deep-map build state lives OUTSIDE the Dashboard so a run survives navigation.
// The graph.build subscription is hosted at the App level (GraphBuildRunHost);
// unsubscribing CANCELS the main-side run, so the host must stay mounted.
interface GraphBuildRunState {
  running: boolean
  requestId: string | null
  projectPath: string | null
  start: (projectPath: string) => void
  // Flipping `running` off switches the subscription input to skipToken, which
  // unsubscribes → the main-side run is cancelled in the observable teardown.
  cancel: () => void
  finish: () => void
}

export const useGraphBuildRun = create<GraphBuildRunState>((set) => ({
  running: false,
  requestId: null,
  projectPath: null,
  start: (projectPath) =>
    set({ running: true, projectPath, requestId: `build-${projectPath}-${Date.now()}` }),
  cancel: () => set({ running: false }),
  finish: () => set({ running: false }),
}))
