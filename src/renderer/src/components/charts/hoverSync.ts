// Shared crosshair state for charts in the same sync group. The active date is
// the x-axis category currently hovered on any synced chart; each chart reads it
// to render a matching readout.
export interface HoverState {
  activeDate: string | null
}

export type HoverAction = { type: 'set'; date: string | null } | { type: 'clear' }

export const initialHover: HoverState = { activeDate: null }

export function hoverReducer(state: HoverState, action: HoverAction): HoverState {
  switch (action.type) {
    case 'set':
      return state.activeDate === action.date ? state : { activeDate: action.date }
    case 'clear':
      return state.activeDate === null ? state : { activeDate: null }
    default:
      return state
  }
}
