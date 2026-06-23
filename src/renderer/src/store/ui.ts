import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type Section =
  | 'dashboard'
  | 'stats'
  | 'productivity'
  | 'knowledge'
  | 'news'
  | 'info'
  | 'skills'
  | 'plugins'
  | 'settings'

export const SECTIONS: readonly Section[] = [
  'dashboard',
  'stats',
  'productivity',
  'knowledge',
  'news',
  'info',
  'skills',
  'plugins',
  'settings',
]

interface UiState {
  section: Section
  selectedProject: string | null
  tabsBySection: Partial<Record<Section, string>>
  setSection: (section: Section) => void
  setSelectedProject: (project: string | null) => void
  setTab: (section: Section, tab: string) => void
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
  return { ...current, section, selectedProject, tabsBySection }
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
  Pick<UiState, 'section' | 'selectedProject' | 'tabsBySection'>
>(() => (typeof localStorage !== 'undefined' ? localStorage : noopStorage))

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      section: 'dashboard',
      selectedProject: null,
      tabsBySection: {},
      setSection: (section) => set({ section }),
      setSelectedProject: (selectedProject) => set({ selectedProject }),
      setTab: (section, tab) =>
        set((s) => ({ tabsBySection: { ...s.tabsBySection, [section]: tab } })),
    }),
    {
      name: 'atlas-ui',
      version: 1,
      storage: guardedStorage,
      partialize: (s) => ({
        section: s.section,
        selectedProject: s.selectedProject,
        tabsBySection: s.tabsBySection,
      }),
      merge: (persisted, current) => mergePersistedUi(persisted, current),
    },
  ),
)
