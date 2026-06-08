import { Bar, BarChart, Line, LineChart, ResponsiveContainer } from 'recharts'

// A mute sparkline: a single series, no axes, no grid, no tooltip, no legend.
// Used on the Dashboard to show a metric's shape at a glance — the Productivity
// page owns the full interactive version of the same data.
export function Sparkline({
  data,
  dataKey,
  kind = 'line',
  color = 'var(--color-chart-1)',
  height = 36,
}: {
  data: Array<Record<string, unknown>>
  dataKey: string
  kind?: 'line' | 'bar'
  color?: string
  height?: number
}) {
  if (data.length === 0) return null
  return (
    <div style={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'line' ? (
          <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
            <Bar dataKey={dataKey} fill={color} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
