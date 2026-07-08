import { useUiStore } from '@renderer/store/ui'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ChatSessionType = 'roadmap' | 'skillImprover' | 'generalChat' | 'worker'

export interface ChatSession {
  id: string
  type: ChatSessionType
  title: string
}

const DEFAULT_TITLES: Record<ChatSessionType, string> = {
  roadmap: 'idea incubator',
  skillImprover: 'improver',
  generalChat: 'chat',
  worker: 'worker',
}

const VALID_TYPES: ChatSessionType[] = ['roadmap', 'skillImprover', 'generalChat', 'worker']

export const MIN_SPLIT = 0.2
export const MAX_SPLIT = 0.8
const clampRatio = (r: number): number => Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, r))

// UI-only state for the unified chat drawer. Deliberately domain-agnostic: it
// tracks which chat tabs are visible, not the chat sessions themselves (those
// live in the per-type run stores). One session per type → id === type.
export interface ChatsState {
  sessions: ChatSession[]
  activeSessionId: string | null

  openSession: (s: { type: ChatSessionType; title?: string }) => void
  closeSession: (id: string) => void
  setActive: (id: string) => void

  splitRatio: number
  setSplitRatio: (r: number) => void
  canvasTabByType: Partial<Record<ChatSessionType, string>>
  setCanvasTab: (type: ChatSessionType, tab: string) => void
}

// Pure sanitizer for rehydrated state: drop sessions with unknown types or bad
// shape, keep the active id only if it still exists, and always keep live
// action functions from `current`.
export function mergePersistedChats(persisted: unknown, current: ChatsState): ChatsState {
  const p = (persisted ?? {}) as Partial<ChatsState>
  const sessions = Array.isArray(p.sessions)
    ? p.sessions.filter(
        (s): s is ChatSession =>
          !!s &&
          typeof s.id === 'string' &&
          VALID_TYPES.includes(s.type) &&
          typeof s.title === 'string',
      )
    : []
  const activeSessionId =
    typeof p.activeSessionId === 'string' && sessions.some((s) => s.id === p.activeSessionId)
      ? p.activeSessionId
      : (sessions[0]?.id ?? null)
  const splitRatio =
    typeof p.splitRatio === 'number' && Number.isFinite(p.splitRatio)
      ? clampRatio(p.splitRatio)
      : 0.5
  const canvasTabByType =
    p.canvasTabByType && typeof p.canvasTabByType === 'object' && !Array.isArray(p.canvasTabByType)
      ? (p.canvasTabByType as Partial<Record<ChatSessionType, string>>)
      : {}
  return {
    ...current,
    sessions,
    activeSessionId,
    splitRatio,
    canvasTabByType,
  }
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
}

const storage = createJSONStorage<
  Pick<ChatsState, 'sessions' | 'activeSessionId' | 'splitRatio' | 'canvasTabByType'>
>(() => (typeof localStorage !== 'undefined' ? localStorage : noopStorage))

export const useChats = create<ChatsState>()(
  persist(
    (set) => ({
      sessions: [],
      activeSessionId: null,

      openSession: ({ type, title }) =>
        set((s) => {
          const existing = s.sessions.find((x) => x.type === type)
          if (existing) {
            return {
              activeSessionId: existing.id,
              sessions: s.sessions.map((x) =>
                x.id === existing.id ? { ...x, title: title ?? x.title } : x,
              ),
            }
          }
          const session: ChatSession = { id: type, type, title: title ?? DEFAULT_TITLES[type] }
          return { sessions: [...s.sessions, session], activeSessionId: session.id }
        }),

      closeSession: (id) =>
        set((s) => {
          const sessions = s.sessions.filter((x) => x.id !== id)
          const activeSessionId =
            s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId
          return { sessions, activeSessionId }
        }),

      setActive: (id) => set({ activeSessionId: id }),

      splitRatio: 0.5,
      setSplitRatio: (r) => set({ splitRatio: clampRatio(r) }),
      canvasTabByType: {},
      setCanvasTab: (type, tab) =>
        set((s) => ({ canvasTabByType: { ...s.canvasTabByType, [type]: tab } })),
    }),
    {
      name: 'atlas-chat-drawer',
      version: 2,
      storage,
      partialize: (s) => ({
        sessions: s.sessions,
        activeSessionId: s.activeSessionId,
        splitRatio: s.splitRatio,
        canvasTabByType: s.canvasTabByType,
      }),
      merge: (persisted, current) => mergePersistedChats(persisted, current),
    },
  ),
)

// Open (or focus) a chat and bring the CHATS page forward. External callers
// (Roadmap/Skills/Dashboard) use this instead of openSession so a
// button press both starts the chat and navigates to it.
export function goToChat(input: { type: ChatSessionType; title?: string }): void {
  useChats.getState().openSession(input)
  useUiStore.getState().setSection('chats')
}
