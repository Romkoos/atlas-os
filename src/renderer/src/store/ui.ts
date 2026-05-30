import { create } from 'zustand'

export type Section =
  | 'dashboard'
  | 'stats'
  | 'productivity'
  | 'knowledge'
  | 'info'
  | 'skills'
  | 'settings'

interface UiState {
  section: Section
  setSection: (section: Section) => void
}

export const useUiStore = create<UiState>((set) => ({
  section: 'dashboard',
  setSection: (section) => set({ section }),
}))
