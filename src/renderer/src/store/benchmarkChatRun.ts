import { createChatRunStore } from '@renderer/store/createChatRunStore'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

// Benchmark-discussion run. Persisted + resumable via the generic factory; the
// subscription is hosted at App level (ChatHost).
export const useBenchmarkChatRun = createChatRunStore('atlas-chat-run-benchmark')

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
}

// Domain extra: the kickoff is the benchmark batchId (not a user message).
// Persisted so app-restart resume can re-send it as the kickoff and the backend
// rebuilds the discussion seed from stored analysis.
interface BenchmarkChatContext {
  batchId: string | null
  setBatch: (id: string) => void
  clearBatch: () => void
}
export const useBenchmarkChatContext = create<BenchmarkChatContext>()(
  persist(
    (set) => ({
      batchId: null,
      setBatch: (batchId) => set({ batchId }),
      clearBatch: () => set({ batchId: null }),
    }),
    {
      name: 'atlas-chat-run-benchmark-ctx',
      version: 1,
      storage: createJSONStorage(() =>
        typeof localStorage !== 'undefined' ? localStorage : noopStorage,
      ),
      partialize: (s) => ({ batchId: s.batchId }),
    },
  ),
)
