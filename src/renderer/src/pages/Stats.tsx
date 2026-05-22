import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { trpc } from '@renderer/lib/trpc'
import { RefreshCw } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="font-medium text-muted-foreground text-xs">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <span className="font-semibold text-2xl tabular-nums">{value}</span>
      </CardContent>
    </Card>
  )
}

export function Stats() {
  const utils = trpc.useUtils()
  const summary = trpc.stats.summary.useQuery()
  const daily = trpc.stats.daily.useQuery()

  const refreshing = summary.isFetching || daily.isFetching
  const data = daily.data ?? []

  const total = summary.data?.total ?? 0
  const avgDuration = `${((summary.data?.avgDurationMs ?? 0) / 1000).toFixed(1)}s`
  const avgTokens = String(summary.data?.avgTokens ?? 0)
  const lastRun = summary.data?.lastRun ? new Date(summary.data.lastRun).toLocaleString() : '—'

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Stats"
        description="Usage over the last 30 days."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => utils.stats.invalidate()}
            disabled={refreshing}
          >
            <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MetricCard label="Total events" value={String(total)} />
          <MetricCard label="Avg duration" value={avgDuration} />
          <MetricCard label="Avg response tokens" value={avgTokens} />
          <MetricCard label="Last run" value={lastRun} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Events per day</CardTitle>
          </CardHeader>
          <CardContent>
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
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--color-popover-foreground)',
                    }}
                  />
                  <Bar dataKey="count" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
