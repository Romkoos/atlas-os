import { createContext, type ReactNode, useContext, useMemo, useReducer } from 'react'
import { hoverReducer, initialHover } from './hoverSync'

interface HoverSyncValue {
  activeDate: string | null
  setActiveDate: (date: string | null) => void
}

const HoverSyncCtx = createContext<HoverSyncValue | null>(null)

// Inert value for charts rendered outside a provider; hoisted so each
// useHoverSync call returns the same reference.
const NOOP_HOVER: HoverSyncValue = { activeDate: null, setActiveDate: () => {} }

export function HoverSyncProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(hoverReducer, initialHover)
  const value = useMemo<HoverSyncValue>(
    () => ({
      activeDate: state.activeDate,
      setActiveDate: (date) => dispatch(date == null ? { type: 'clear' } : { type: 'set', date }),
    }),
    [state.activeDate],
  )
  return <HoverSyncCtx.Provider value={value}>{children}</HoverSyncCtx.Provider>
}

// Safe outside a provider: standalone charts get an inert no-op.
export function useHoverSync(): HoverSyncValue {
  return useContext(HoverSyncCtx) ?? NOOP_HOVER
}
