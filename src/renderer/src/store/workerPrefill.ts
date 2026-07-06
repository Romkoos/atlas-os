import type { ClaudeModelId } from '@shared/models'
import { create } from 'zustand'

// A transient, one-shot hand-off used to seed the worker chat's intro composer
// from outside (e.g. the Roadmap "start development" button). The worker intro
// reads `pending` on its next render, copies the prompt/model into its local
// draft state, then calls clearPrefill(). Deliberately NOT persisted — it's a
// momentary hand-off, not durable chat state.
export interface WorkerPrefill {
  prompt: string
  // Model to preselect. null → the global default model.
  model: ClaudeModelId | null
}

export interface WorkerPrefillState {
  pending: WorkerPrefill | null
  setPrefill: (p: WorkerPrefill) => void
  clearPrefill: () => void
}

export const useWorkerPrefill = create<WorkerPrefillState>()((set) => ({
  pending: null,
  setPrefill: (p) => set({ pending: p }),
  clearPrefill: () => set({ pending: null }),
}))
