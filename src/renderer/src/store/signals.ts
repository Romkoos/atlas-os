import type { SignalsSnapshot, SignalView } from '@shared/signals'
import { create } from 'zustand'

// Live signals mirror, fed by the single SignalsHost subscription. The dashboard
// feed and the sidebar unread badge read from here, so there's exactly one open
// signals.list subscription for the whole app.
interface SignalsState {
  signals: SignalView[]
  unreadCount: number
  setSnapshot: (snap: SignalsSnapshot) => void
}

export const useSignalsStore = create<SignalsState>((set) => ({
  signals: [],
  unreadCount: 0,
  setSnapshot: (snap) => set({ signals: snap.signals, unreadCount: snap.unreadCount }),
}))
