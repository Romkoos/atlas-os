// Shared <Brush> styling + range type. recharts can't detect a <Brush> wrapped
// in a custom component (it scans children by type), so each chart renders
// <Brush> inline and spreads these props for a consistent terminal look.

import { formatDayMonth } from '@renderer/lib/utils'

export interface BrushRange {
  startIndex?: number
  endIndex?: number
}

// Spread onto an inline recharts <Brush>. Date axis, short MM-DD traveller
// labels, hairline stroke, muted unselected fill, narrow travellers.
export const brushProps = {
  dataKey: 'date',
  height: 18,
  travellerWidth: 8,
  stroke: 'var(--color-chart-1)',
  fill: 'var(--color-muted)',
  tickFormatter: (v: string | number): string => formatDayMonth(String(v)),
}
