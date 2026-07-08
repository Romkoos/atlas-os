import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Section =
  | 'dashboard'
  | 'roadmap'
  | 'chats'
  | 'knowledge'
  | 'news'
  | 'signals'
  | 'skills'
  | 'plugins'
  | 'settings'

export const SECTIONS: readonly Section[] = [
  'dashboard',
  'roadmap',
  'chats',
  'knowledge',
  'news',
  'signals',
  'skills',
  'plugins',
  'settings',
]

// Default graph sources: everything except sessions (session_touched edges are
// ~74% of the structural graph and read as noise).
export const DEFAULT_GRAPH_SOURCES: string[] = ['code', 'doc', 'knowledge', 'skill', 'graphify']

interface UiState {
  section: Section
  selectedProject: string | null
  tabsBySection: Partial<Record<Section, string>>
  roadmapHideDone: boolean
  graphSources: string[]
  setSection: (section: Section) => void
  setSelectedProject: (project: string | null) => void
  setTab: (section: Section, tab: string) => void
  setRoadmapHideDone: (v: boolean) => void
  setGraphSources: (sources: string[]) => void
}

// Pure sanitizer for rehydrated state. A persisted blob can be partial, stale,
// or corrupt (renamed section across versions, hand-edited localStorage). Coerce
// it into valid state and always keep live action functions from `current`.
export function mergePersistedUi(persisted: unknown, current: UiState): UiState {
  const p = (persisted ?? {}) as Partial<UiState>
  const section =
    typeof p.section === 'string' && (SECTIONS as readonly string[]).includes(p.section)
      ? (p.section as Section)
      : 'dashboard'
  const selectedProject = typeof p.selectedProject === 'string' ? p.selectedProject : null
  const tabsBySection =
    p.tabsBySection && typeof p.tabsBySection === 'object' && !Array.isArray(p.tabsBySection)
      ? (p.tabsBySection as Partial<Record<Section, string>>)
      : {}
  const roadmapHideDone = typeof p.roadmapHideDone === 'boolean' ? p.roadmapHideDone : false
  const graphSources =
    Array.isArray(p.graphSources) && p.graphSources.every((s) => typeof s === 'string')
      ? (p.graphSources as string[])
      : DEFAULT_GRAPH_SOURCES
  return { ...current, section, selectedProject, tabsBySection, roadmapHideDone, graphSources }
}

// Guarded storage: uses a no-op in-memory store when DOM localStorage is absent,
// so importing this module under Vitest's node environment does not throw.
const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
}

const guardedStorage = createJSONStorage<
  Pick<
    UiState,
    'section' | 'selectedProject' | 'tabsBySection' | 'roadmapHideDone' | 'graphSources'
  >
>(() => (typeof localStorage !== 'undefined' ? localStorage : noopStorage))

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      section: 'dashboard',
      selectedProject: null,
      tabsBySection: {},
      roadmapHideDone: false,
      graphSources: DEFAULT_GRAPH_SOURCES,
      setSection: (section) => set({ section }),
      setSelectedProject: (selectedProject) => set({ selectedProject }),
      setTab: (section, tab) =>
        set((s) => ({ tabsBySection: { ...s.tabsBySection, [section]: tab } })),
      setRoadmapHideDone: (roadmapHideDone) => set({ roadmapHideDone }),
      setGraphSources: (graphSources) => set({ graphSources }),
    }),
    {
      name: 'atlas-ui',
      version: 1,
      storage: guardedStorage,
      partialize: (s) => ({
        section: s.section,
        selectedProject: s.selectedProject,
        tabsBySection: s.tabsBySection,
        roadmapHideDone: s.roadmapHideDone,
        graphSources: s.graphSources,
      }),
      merge: (persisted, current) => mergePersistedUi(persisted, current),
    },
  ),
)
