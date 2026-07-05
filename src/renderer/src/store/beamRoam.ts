import { create } from 'zustand'

// The dashboard's border-beam roams: every few seconds it lights ONE random
// panel for a single lightning lap. Each candidate panel subscribes by key and
// renders the beam only while it's the active one; Dashboard owns the timer.
export type BeamKey = 'quick' | 'graph' | 'nextup' | 'signals' | 'activity' | 'processes'

const KEYS: BeamKey[] = ['quick', 'graph', 'nextup', 'signals', 'activity', 'processes']

interface BeamRoamState {
  active: BeamKey
  roam: () => void
}

export const useBeamRoam = create<BeamRoamState>((set, get) => ({
  active: 'quick',
  // Jump to a DIFFERENT random panel each tick so the beam always visibly moves.
  roam: () => {
    const others = KEYS.filter((k) => k !== get().active)
    set({ active: others[Math.floor(Math.random() * others.length)] ?? 'quick' })
  },
}))
