import { createChatRunStore } from '@renderer/store/createChatRunStore'
import type { RoadmapItem } from '@shared/roadmap'
import { create } from 'zustand'

// Roadmap brainstorming run. Persisted + resumable via the generic factory; the
// subscription is hosted at App level (ChatHost).
export const useRoadmapChatRun = createChatRunStore('atlas-chat-run-roadmap')

// Domain extra: the saved-idea banner. Not persisted — it's a transient
// confirmation for the live session, re-derivable only from a fresh `saved`
// event, so it resets on reload.
interface RoadmapSavedState {
  savedItem: RoadmapItem | null
  setSaved: (item: RoadmapItem) => void
  clearSaved: () => void
}
export const useRoadmapSaved = create<RoadmapSavedState>((set) => ({
  savedItem: null,
  setSaved: (savedItem) => set({ savedItem }),
  clearSaved: () => set({ savedItem: null }),
}))
