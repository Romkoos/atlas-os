import type { SignalView } from '@shared/signals'

// Max number of signal rows the Dashboard SignalsPanel shows. The panel sits in
// the hero row and stretches to the GalaxyHero's height; 10 rows fill that space
// without overflowing (the panel-body scrolls if they ever do). The full feed
// lives on the Signals page ("view all").
export const SIGNALS_PANEL_LIMIT = 10

// Cap a signal feed to the dashboard panel limit, preserving order (the store
// already emits newest-first). Returns all signals when under the limit.
export function capSignalsForPanel(signals: SignalView[]): SignalView[] {
  return signals.slice(0, SIGNALS_PANEL_LIMIT)
}
