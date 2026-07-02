import { create } from 'zustand'

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

// UI-only state for the unified chat drawer. Deliberately domain-agnostic: it
// tracks which chat tabs are visible, not the chat sessions themselves (those
// live in benchmarkChatRun / roadmapChatRun). One session per type → id === type.
interface ChatDrawerState {
  open: boolean
  sessions: ChatSession[]
  activeSessionId: string | null

  openSession: (s: { type: ChatSessionType; title?: string }) => void
  closeSession: (id: string) => void
  setActive: (id: string) => void
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useChatDrawer = create<ChatDrawerState>((set) => ({
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
  toggle: () => set((s) => ({ open: !s.open })),
}))
