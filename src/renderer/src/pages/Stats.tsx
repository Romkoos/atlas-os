import { ChartFrame } from '@renderer/components/charts/ChartFrame'
import { eventsPerDayMeta } from '@renderer/components/charts/chartMeta'
import { brushProps } from '@renderer/components/charts/rangeBrush'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { formatDateTime } from '@renderer/lib/utils'
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function Spark({ values, w = 70, h = 22 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / range) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ position: 'absolute', top: 16, right: 18 }}
      role="img"
      aria-label="trend"
    >
      <title>trend</title>
      <polyline points={pts} fill="none" stroke="var(--amber)" strokeWidth="1" />
    </svg>
  )
}

export function Stats() {
  const utils = trpc.useUtils()
  const summary = trpc.stats.summary.useQuery()
  const daily = trpc.stats.daily.useQuery()

  const refreshing = summary.isFetching || daily.isFetching
  const data = daily.data ?? []

  const total = summary.data?.total ?? 0
  const avgDurationMs = summary.data?.avgDurationMs ?? 0
  const avgTokens = summary.data?.avgTokens ?? 0
  const lastRun = formatDateTime(summary.data?.lastRun ?? null)

  const sparkValues = data.map((d) => d.count)

  function refresh() {
    void utils.stats.invalidate()
  }

  return (
    <>
      <PageHeader
        num="02"
        title="STATS"
        description="Usage over the last 30 days."
        action={
          <button type="button" className="btn" onClick={refresh} disabled={refreshing}>
            {refreshing ? '↻ REFRESHING…' : '↻ REFRESH'}
          </button>
        }
      />
      <div className="scroll">
        <div className="kpis k4">
          {/* [01] TOTAL EVENTS */}
          <div className="kpi">
            <div className="label">
              <span className="id">[01]</span>TOTAL EVENTS
            </div>
            <div className="val">{total}</div>
            <div className="delta">last 30 days</div>
            <Spark values={sparkValues} />
          </div>

          {/* [02] AVG DURATION */}
          <div className="kpi">
            <div className="label">
              <span className="id">[02]</span>AVG DURATION
            </div>
            <div className="val">
              {(avgDurationMs / 1000).toFixed(1)}
              <span className="u">s</span>
            </div>
            <div className="delta">per run</div>
          </div>

          {/* [03] AVG RESPONSE TOKENS */}
          <div className="kpi">
            <div className="label">
              <span className="id">[03]</span>AVG RESPONSE TOKENS
            </div>
            <div className="val">{avgTokens}</div>
            <div className="delta">output tokens / run</div>
          </div>

          {/* [04] LAST RUN */}
          <div className="kpi">
            <div className="label">
              <span className="id">[04]</span>LAST RUN
            </div>
            <div className="val" style={{ fontSize: 16 }}>
              {lastRun}
            </div>
            <div className="delta">&nbsp;</div>
          </div>
        </div>

        <ChartFrame meta={eventsPerDayMeta}>
          {() => (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    interval="preserveStartEnd"
                    minTickGap={16}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    width={32}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
                    contentStyle={{
                      background: 'var(--color-popover)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 0,
                      fontSize: 12,
                      color: 'var(--color-popover-foreground)',
                    }}
                  />
                  <Bar dataKey="count" fill="var(--color-chart-1)" radius={[0, 0, 0, 0]} />
                  <Brush {...brushProps} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartFrame>
      </div>
    </>
  )
}
