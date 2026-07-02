import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ChatSessionType = 'benchmark' | 'roadmap' | 'skillImprover' | 'generalChat'

export interface ChatSession {
  id: string
  type: ChatSessionType
  title: string
}

const DEFAULT_TITLES: Record<ChatSessionType, string> = {
  benchmark: 'discuss results',
  roadmap: 'idea incubator',
  skillImprover: 'improver',
  generalChat: 'chat',
}

const VALID_TYPES: ChatSessionType[] = ['benchmark', 'roadmap', 'skillImprover', 'generalChat']

// UI-only state for the unified chat drawer. Deliberately domain-agnostic: it
// tracks which chat tabs are visible, not the chat sessions themselves (those
// live in the per-type run stores). One session per type → id === type.
export interface ChatDrawerState {
  open: boolean
  sessions: ChatSession[]
  activeSessionId: string | null

  openSession: (s: { type: ChatSessionType; title?: string }) => void
  closeSession: (id: string) => void
  setActive: (id: string) => void
  setOpen: (open: boolean) => void
}

// Pure sanitizer for rehydrated state: drop sessions with unknown types or bad
// shape, keep the active id only if it still exists, and always keep live
// action functions from `current`.
export function mergePersistedChatDrawer(
  persisted: unknown,
  current: ChatDrawerState,
): ChatDrawerState {
  const p = (persisted ?? {}) as Partial<ChatDrawerState>
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
  return { ...current, open: Boolean(p.open) && sessions.length > 0, sessions, activeSessionId }
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
}

const storage = createJSONStorage<Pick<ChatDrawerState, 'open' | 'sessions' | 'activeSessionId'>>(
  () => (typeof localStorage !== 'undefined' ? localStorage : noopStorage),
)

export const useChatDrawer = create<ChatDrawerState>()(
  persist(
    (set) => ({
      open: false,
      sessions: [],
      activeSessionId: null,

      openSession: ({ type, title }) =>
        set((s) => {
          const existing = s.sessions.find((x) => x.type === type)
          if (existing) {
            return {
              open: true,
              activeSessionId: existing.id,
              sessions: s.sessions.map((x) =>
                x.id === existing.id ? { ...x, title: title ?? x.title } : x,
              ),
            }
          }
          const session: ChatSession = { id: type, type, title: title ?? DEFAULT_TITLES[type] }
          return { open: true, sessions: [...s.sessions, session], activeSessionId: session.id }
        }),

      closeSession: (id) =>
        set((s) => {
          const sessions = s.sessions.filter((x) => x.id !== id)
          const activeSessionId =
            s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId
          return { sessions, activeSessionId, open: sessions.length > 0 ? s.open : false }
        }),

      setActive: (id) => set({ activeSessionId: id }),
      setOpen: (open) => set({ open }),
    }),
    {
      name: 'atlas-chat-drawer',
      version: 1,
      storage,
      partialize: (s) => ({ open: s.open, sessions: s.sessions, activeSessionId: s.activeSessionId }),
      merge: (persisted, current) => mergePersistedChatDrawer(persisted, current),
    },
  ),
)
