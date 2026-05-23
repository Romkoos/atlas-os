import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'
import { kpiSession } from '@shared/kpi'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'

type Tab = 'overview' | 'sessions' | 'ecosystem'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'ecosystem', label: 'Ecosystem' },
]

const RANGES: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: '1d' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
]

const ALL_PROJECTS = 'all'

// Scope shared by every tab: time window + optional project filter.
interface Scope {
  days: number
  projectPath?: string
}

const fmtInt = new Intl.NumberFormat('en-US')
const num = (n: number): string => fmtInt.format(n)
const dash = (v: number | null, digits = 1): string => (v == null ? '—' : v.toFixed(digits))
const scoreLabel = (avg: number | null, rated: number, total: number): string =>
  rated === 0 ? '—' : `${avg == null ? '—' : avg.toFixed(1)} · ${rated}/${total} rated`
// Dates cross IPC as real Date objects (structured clone), but tRPC's transformer-less
// type inference reports them as string — accept both and normalize.
const fmtDate = (d: Date | string | null): string => (d ? new Date(d).toLocaleString() : '—')

const tooltipStyle = {
  background: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--color-popover-foreground)',
}

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

function EmptyHint() {
  return (
    <Card>
      <CardContent className="py-12 text-center">
        <p className="font-medium text-sm">No data in this range.</p>
        <p className="mt-1 text-muted-foreground text-sm">
          Widen the range, clear the project filter, or Refresh after using Claude Code.
        </p>
      </CardContent>
    </Card>
  )
}

function Loading() {
  return <p className="px-1 py-4 text-muted-foreground text-sm">Loading…</p>
}

// Tokens-per-day tooltip: tokens in/out + any ecosystem change logged that day.
function TokensTooltip(props: {
  active?: boolean
  label?: string | number
  payload?: { payload: { tokensIn: number; tokensOut: number; event: string | null } }[]
}) {
  const row = props.payload?.[0]?.payload
  if (!props.active || !row) return null
  return (
    <div style={tooltipStyle} className="px-2.5 py-2 text-xs">
      <div className="mb-1 font-medium">{props.label}</div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Tokens in</span>
        <span className="tabular-nums">{num(row.tokensIn)}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Tokens out</span>
        <span className="tabular-nums">{num(row.tokensOut)}</span>
      </div>
      {row.event ? (
        <div className="mt-1.5 max-w-56 border-t pt-1.5 text-[var(--color-chart-3)]">
          ⚑ {row.event}
        </div>
      ) : null}
    </div>
  )
}

// KPI-per-day tooltip: efficiency value + session count + any ecosystem change.
function KpiTooltip(props: {
  active?: boolean
  label?: string | number
  payload?: { payload: { kpi: number | null; sessions: number; event: string | null } }[]
}) {
  const row = props.payload?.[0]?.payload
  if (!props.active || !row) return null
  return (
    <div style={tooltipStyle} className="px-2.5 py-2 text-xs">
      <div className="mb-1 font-medium">{props.label}</div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">KPI</span>
        <span className="tabular-nums">{row.kpi == null ? '—' : row.kpi.toFixed(1)}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Sessions</span>
        <span className="tabular-nums">{row.sessions}</span>
      </div>
      {row.event ? (
        <div className="mt-1.5 max-w-56 border-t pt-1.5 text-[var(--color-chart-3)]">
          ⚑ {row.event}
        </div>
      ) : null}
    </div>
  )
}

// Compact horizontal bar list for tool/skill usage frequency.
function UsageList({
  items,
  nameClassName = 'w-32',
}: {
  items: { name: string; count: number }[]
  nameClassName?: string
}) {
  const top = items.slice(0, 10)
  const max = top.reduce((m, i) => Math.max(m, i.count), 0) || 1
  return (
    <ul className="flex flex-col gap-2">
      {top.map((item) => (
        <li key={item.name} className="flex items-center gap-3">
          <span className={cn(nameClassName, 'shrink-0 truncate text-sm')} title={item.name}>
            {item.name}
          </span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[var(--color-chart-1)]"
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
          <span className="w-8 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
            {item.count}
          </span>
        </li>
      ))}
    </ul>
  )
}

// Vertical dashed markers for ecosystem-change days, drawn as a chart child via
// recharts v3 hooks. Reliable across re-renders, unlike <ReferenceLine> fed by
// an async query (which intermittently fails to paint).
function EcoMarkers({ events }: { events: { date: string; count: number; label: string }[] }) {
  const xScale = useXAxisScale()
  const plot = usePlotArea()
  if (!xScale || !plot) return null
  return (
    <g>
      {events.map((e) => {
        const cx = xScale(e.date, { position: 'middle' })
        if (cx == null) return null
        const top = plot.y
        const bottom = plot.y + plot.height
        return (
          <g key={e.date}>
            <line
              x1={cx}
              x2={cx}
              y1={top}
              y2={bottom}
              stroke="var(--color-chart-3)"
              strokeWidth={2}
              strokeDasharray="4 2"
            />
            {/* Wide transparent hit area so the native tooltip is easy to trigger,
                even when the day has no (in-scope) bar to hover. */}
            <line
              x1={cx}
              x2={cx}
              y1={top}
              y2={bottom}
              stroke="transparent"
              strokeWidth={12}
              style={{ cursor: 'help' }}
            >
              <title>{`${e.date} — ${e.label}`}</title>
            </line>
            <text x={cx} y={top - 2} textAnchor="middle" fontSize={11} fill="var(--color-chart-3)">
              {e.count > 1 ? `⚑${e.count}` : '⚑'}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function OverviewTab({ days, projectPath }: Scope) {
  const overview = trpc.productivity.overview.useQuery({ days, projectPath })
  const usage = trpc.productivity.toolSkillUsage.useQuery({ days, projectPath })
  const co = trpc.productivity.coOccurrence.useQuery({ days, projectPath })
  const ecoDays = trpc.productivity.ecosystemDays.useQuery({ days })
  const today = trpc.productivity.today.useQuery({ projectPath })
  const kpi = trpc.productivity.kpi.useQuery({ days, projectPath })

  if (overview.isLoading) return <Loading />
  if (overview.isError)
    return <p className="px-1 py-4 text-destructive text-sm">Failed to load overview.</p>

  const tokensByDay = overview.data?.tokensByDay ?? []
  const byProject = overview.data?.byProject ?? []
  const totals = overview.data?.totals

  if (!totals || (totals.turns === 0 && tokensByDay.length === 0)) return <EmptyHint />

  const tools = usage.data?.tools ?? []
  const skills = usage.data?.skills ?? []

  // Ecosystem events are global; the daily bars are scoped (project/tracked
  // filter). So an event day may have no bar in scope. Union both date sets and
  // zero-fill tokens, so the category always exists and a marker can be drawn.
  const ecoMap = new Map((ecoDays.data ?? []).map((e) => [e.date, e] as const))
  const tokMap = new Map(tokensByDay.map((d) => [d.date, d] as const))
  const allDates = [...new Set([...tokMap.keys(), ...ecoMap.keys()])].sort()
  const chartData = allDates.map((date) => ({
    date,
    tokensIn: tokMap.get(date)?.tokensIn ?? 0,
    tokensOut: tokMap.get(date)?.tokensOut ?? 0,
    event: ecoMap.get(date)?.label ?? null,
  }))
  const eventDays = ecoDays.data ?? []

  // KPI per day, unioned with ecosystem-event days (null-filled) so a marker can
  // be drawn even on a day with no in-scope sessions. connectNulls bridges gaps.
  const kpiByDate = new Map((kpi.data?.byDay ?? []).map((d) => [d.date, d] as const))
  const kpiDates = [...new Set([...kpiByDate.keys(), ...ecoMap.keys()])].sort()
  const kpiChartData = kpiDates.map((date) => ({
    date,
    kpi: kpiByDate.get(date)?.kpi ?? null,
    sessions: kpiByDate.get(date)?.sessions ?? 0,
    event: ecoMap.get(date)?.label ?? null,
  }))

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Total tokens" value={num(totals.totalTokens)} />
        <MetricCard label="Sessions" value={num(totals.sessions)} />
        <MetricCard
          label="Avg score (rated)"
          value={scoreLabel(totals.avgScore, totals.ratedCount, totals.totalCount)}
        />
        <MetricCard label="Avg complexity" value={dash(totals.avgComplexity)} />
        <MetricCard label="KPI" value={dash(kpi.data?.overall ?? null)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today by hour</CardTitle>
          <p className="text-muted-foreground text-xs">
            Current local day — ignores the range above.
          </p>
        </CardHeader>
        <CardContent>
          {today.isLoading ? (
            <Loading />
          ) : !today.data || today.data.totals.turns === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">No activity yet today.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground text-xs">
                <span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {num(today.data.totals.totalTokens)}
                  </span>{' '}
                  tokens
                </span>
                <span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {num(today.data.totals.turns)}
                  </span>{' '}
                  turns
                </span>
                <span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {num(today.data.totals.sessions)}
                  </span>{' '}
                  sessions
                </span>
                <span>
                  <span className="font-semibold text-foreground tabular-nums">
                    {num(today.data.totals.activeHours)}
                  </span>{' '}
                  active hours
                </span>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={today.data.hours}
                    margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--color-border)"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(value: string) => `${value}:00`}
                      tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                      stroke="var(--color-border)"
                      interval={1}
                      minTickGap={8}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                      stroke="var(--color-border)"
                      width={44}
                      tickFormatter={(value: number) => num(value)}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
                      contentStyle={tooltipStyle}
                      labelFormatter={(label) => `${label}:00`}
                      formatter={(value, name) => [
                        num(Number(value)),
                        name === 'tokensIn' ? 'Tokens in' : 'Tokens out',
                      ]}
                    />
                    <Bar dataKey="tokensIn" stackId="t" fill="var(--color-chart-1)" />
                    <Bar
                      dataKey="tokensOut"
                      stackId="t"
                      fill="var(--color-chart-2)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tokens per day</CardTitle>
          {(ecoDays.data?.length ?? 0) > 0 ? (
            <p className="text-muted-foreground text-xs">
              ⚑ dashed lines mark ecosystem changes — hover a bar for details.
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {tokensByDay.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">No token activity yet.</p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
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
                    width={44}
                    tickFormatter={(value: number) => num(value)}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
                    content={<TokensTooltip />}
                  />
                  <Bar
                    dataKey="tokensIn"
                    stackId="t"
                    fill="var(--color-chart-1)"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="tokensOut"
                    stackId="t"
                    fill="var(--color-chart-2)"
                    radius={[4, 4, 0, 0]}
                  />
                  <EcoMarkers events={eventDays} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">KPI (efficiency)</CardTitle>
          <p className="text-muted-foreground text-xs">
            (score ?? 5.5) × complexity per 1M tokens, token-weighted per day — higher is better.
            {(ecoDays.data?.length ?? 0) > 0 ? ' ⚑ marks ecosystem changes.' : ''}
          </p>
        </CardHeader>
        <CardContent>
          {kpi.isLoading ? (
            <Loading />
          ) : (kpi.data?.byDay.length ?? 0) === 0 ? (
            <p className="py-8 text-center text-muted-foreground text-sm">No KPI data yet.</p>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={kpiChartData} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
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
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    width={44}
                    tickFormatter={(value: number) => value.toFixed(1)}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--color-muted)', strokeWidth: 1 }}
                    content={<KpiTooltip />}
                  />
                  <Line
                    type="monotone"
                    dataKey="kpi"
                    stroke="var(--color-chart-1)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <EcoMarkers events={eventDays} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By project</CardTitle>
        </CardHeader>
        <CardContent>
          {byProject.length === 0 ? (
            <p className="py-4 text-muted-foreground text-sm">No projects in range.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="py-2 pr-4 font-medium">Project</th>
                    <th className="py-2 pr-4 text-right font-medium">Tokens</th>
                    <th className="py-2 pr-4 text-right font-medium">Turns</th>
                    <th className="py-2 pr-4 text-right font-medium">Sessions</th>
                    <th className="py-2 text-right font-medium">Avg complexity</th>
                  </tr>
                </thead>
                <tbody>
                  {byProject.map((p) => (
                    <tr key={p.projectPath} className="border-b last:border-0">
                      <td className="py-2 pr-4">
                        <span className="font-medium" title={p.projectPath}>
                          {p.project}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(p.totalTokens)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(p.turns)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{num(p.sessions)}</td>
                      <td className="py-2 text-right tabular-nums">{dash(p.avgComplexity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top tools</CardTitle>
          </CardHeader>
          <CardContent>
            {usage.isLoading ? (
              <Loading />
            ) : tools.length === 0 ? (
              <p className="py-4 text-muted-foreground text-sm">No tools recorded yet.</p>
            ) : (
              <UsageList items={tools} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top skills</CardTitle>
          </CardHeader>
          <CardContent>
            {usage.isLoading ? (
              <Loading />
            ) : skills.length === 0 ? (
              <p className="py-4 text-muted-foreground text-sm">No skills recorded yet.</p>
            ) : (
              <UsageList items={skills} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tools used together</CardTitle>
            <p className="text-muted-foreground text-xs">Pairs co-occurring in the same turn.</p>
          </CardHeader>
          <CardContent>
            {co.isLoading ? (
              <Loading />
            ) : (co.data?.toolPairs.length ?? 0) === 0 ? (
              <p className="py-4 text-muted-foreground text-sm">No tool pairs yet.</p>
            ) : (
              <UsageList items={co.data?.toolPairs ?? []} nameClassName="w-44" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Skills used together</CardTitle>
            <p className="text-muted-foreground text-xs">Pairs co-occurring in the same turn.</p>
          </CardHeader>
          <CardContent>
            {co.isLoading ? (
              <Loading />
            ) : (co.data?.skillPairs.length ?? 0) === 0 ? (
              <p className="py-4 text-muted-foreground text-sm">No skill pairs yet.</p>
            ) : (
              <UsageList items={co.data?.skillPairs ?? []} nameClassName="w-44" />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const SESSIONS_PAGE_SIZE = 25

function SessionsTab({ days, projectPath }: Scope) {
  const sessions = trpc.productivity.sessions.useQuery({ days, projectPath })
  const [page, setPage] = useState(0)

  if (sessions.isLoading) return <Loading />
  if (sessions.isError)
    return <p className="px-1 py-4 text-destructive text-sm">Failed to load sessions.</p>

  // Rows arrive newest-first from the router (ordered by startedAt desc).
  const rows = sessions.data ?? []
  if (rows.length === 0) return <EmptyHint />

  const pageCount = Math.ceil(rows.length / SESSIONS_PAGE_SIZE)
  const current = Math.min(page, pageCount - 1) // clamp if scope shrank the list
  const start = current * SESSIONS_PAGE_SIZE
  const pageRows = rows.slice(start, start + SESSIONS_PAGE_SIZE)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground text-xs">
                <th className="py-2 pr-4 font-medium">Project</th>
                <th className="py-2 pr-4 font-medium">Started</th>
                <th className="py-2 pr-4 text-right font-medium">Turns</th>
                <th className="py-2 pr-4 text-right font-medium">Tokens</th>
                <th className="py-2 pr-4 text-right font-medium">Complexity</th>
                <th className="py-2 pr-4 text-right font-medium">KPI</th>
                <th className="py-2 pr-4 font-medium">Rating</th>
                <th className="py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((s) => (
                <tr key={s.sessionId} className="border-b align-top last:border-0">
                  <td className="py-2 pr-4">
                    <span className="font-medium" title={s.projectPath}>
                      {s.project}
                    </span>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">
                    {fmtDate(s.startedAt)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{num(s.turnCount)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{num(s.totalTokens)}</td>
                  <td
                    className="py-2 pr-4 text-right tabular-nums"
                    title={`files ${s.distinctFiles} · dirs ${s.distinctDirs} · tools ${s.distinctTools} · skills ${s.distinctSkills} · subagents ${s.subagentCount}`}
                  >
                    {dash(s.complexity, 1)}
                  </td>
                  <td
                    className="py-2 pr-4 text-right tabular-nums"
                    title="score (or 5.5 if unrated) × complexity ÷ (tokens / 1M) — higher is more efficient"
                  >
                    {dash(kpiSession(s.score, s.complexity, s.totalTokens), 1)}
                  </td>
                  <td className="py-2 pr-4">
                    <RatingControl sessionId={s.sessionId} score={s.score} />
                  </td>
                  <td className="max-w-xs py-2">
                    <span className="line-clamp-2 text-muted-foreground" title={s.summary ?? ''}>
                      {s.summary ?? '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="mt-3 flex items-center justify-between text-muted-foreground text-xs">
            <span className="tabular-nums">
              {start + 1}–{Math.min(start + SESSIONS_PAGE_SIZE, rows.length)} of {rows.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Prev
              </Button>
              <span className="tabular-nums">
                Page {current + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function RatingControl({ sessionId, score }: { sessionId: string; score: number | null }) {
  const utils = trpc.useUtils()
  const setRating = trpc.productivity.setRating.useMutation({
    onSuccess: async () => {
      await utils.productivity.invalidate()
    },
    onError: () => toast.error('Failed to save rating'),
  })
  return (
    <select
      aria-label={`Quality rating for session ${sessionId}`}
      className="rounded border bg-background px-1 py-0.5 text-sm tabular-nums"
      value={score ?? ''}
      disabled={setRating.isPending}
      onChange={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value)
        setRating.mutate({ sessionId, score: v })
      }}
    >
      <option value="">— (7)</option>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  )
}

function EcoBadge({ type }: { type: string }) {
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {type.replace(/_/g, ' ')}
    </span>
  )
}

// Tokens-per-turn before vs after a change. Fewer tokens/turn = more efficient,
// so a negative delta is the "good" direction (shown green).
function ImpactDelta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>
  const sign = pct > 0 ? '+' : ''
  return (
    <span className={cn('tabular-nums', pct < 0 ? 'text-emerald-500' : 'text-destructive')}>
      {sign}
      {pct.toFixed(0)}%
    </span>
  )
}

function EcosystemTab({ days }: { days: number }) {
  const utils = trpc.useUtils()
  const ecosystem = trpc.productivity.ecosystem.useQuery({ days })
  const impact = trpc.productivity.ecosystemImpact.useQuery({})
  const addNote = trpc.productivity.addNote.useMutation()
  const [note, setNote] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  if (ecosystem.isLoading) return <Loading />
  if (ecosystem.isError)
    return <p className="px-1 py-4 text-destructive text-sm">Failed to load ecosystem.</p>

  const rows = ecosystem.data ?? []
  const impactRows = impact.data ?? []
  const tpt = (v: number | null): string => (v == null ? '—' : num(Math.round(v)))

  const submitNote = async () => {
    if (!note.trim()) return
    try {
      await addNote.mutateAsync({ ts: new Date(`${date}T12:00:00`), note: note.trim() })
      setNote('')
      await utils.productivity.invalidate()
      toast.success('Note added')
    } catch {
      toast.error('Failed to add note')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mark a change</CardTitle>
          <p className="text-muted-foreground text-xs">
            Auto-tracking (config / skill edits) needs the agent-analytics hooks installed
            (scripts/agent-analytics/INSTALL.md). Until then log changes here — each becomes a
            dashed line on “Tokens per day” and a row in Change impact.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-40"
              aria-label="Change date"
            />
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNote()
              }}
              placeholder="What changed? e.g. Added context7 MCP"
              className="min-w-56 flex-1"
              aria-label="Change note"
            />
            <Button size="sm" onClick={submitNote} disabled={addNote.isPending || !note.trim()}>
              Add note
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change impact</CardTitle>
          <p className="text-muted-foreground text-xs">
            Avg tokens/turn 7 days before vs after each change (global). Lower after = more
            efficient.
          </p>
        </CardHeader>
        <CardContent>
          {impact.isLoading ? (
            <Loading />
          ) : impactRows.length === 0 ? (
            <p className="py-4 text-muted-foreground text-sm">No changes in the last 60 days.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground text-xs">
                    <th className="py-2 pr-4 font-medium">When</th>
                    <th className="py-2 pr-4 font-medium">Change</th>
                    <th className="py-2 pr-4 text-right font-medium">tok/turn before</th>
                    <th className="py-2 pr-4 text-right font-medium">after</th>
                    <th className="py-2 text-right font-medium">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {impactRows.map((r) => (
                    <tr key={r.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-4 whitespace-nowrap text-muted-foreground tabular-nums">
                        {fmtDate(r.ts)}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-2">
                          <EcoBadge type={r.type} />
                          <span className="min-w-0 truncate" title={r.target ?? ''}>
                            {r.target ?? '—'}
                          </span>
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {tpt(r.tokPerTurnBefore)}
                        <span className="ml-1 text-muted-foreground text-xs">
                          ({r.turnsBefore})
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {tpt(r.tokPerTurnAfter)}
                        <span className="ml-1 text-muted-foreground text-xs">({r.turnsAfter})</span>
                      </td>
                      <td className="py-2 text-right">
                        <ImpactDelta pct={r.deltaPct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-muted-foreground text-xs">
                (n) = turns in each window. Rows with no turns on a side show —.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ecosystem changes</CardTitle>
          <p className="text-muted-foreground text-xs">
            Global — not affected by the project filter.
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="py-4 text-muted-foreground text-sm">
              No ecosystem changes yet. Install the agent-analytics hooks or add a note above.
            </p>
          ) : (
            <ol className="flex flex-col gap-3">
              {rows.map((c) => (
                <li key={c.id} className="flex gap-3 border-b pb-3 last:border-0 last:pb-0">
                  <span className="w-36 shrink-0 text-muted-foreground text-xs tabular-nums">
                    {fmtDate(c.ts)}
                  </span>
                  <EcoBadge type={c.type} />
                  <span className="min-w-0 flex-1 break-words text-sm">
                    {c.target ?? c.note ?? '—'}
                    {c.target && c.note ? (
                      <span className="text-muted-foreground"> — {c.note}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function Productivity() {
  const utils = trpc.useUtils()
  const refresh = trpc.productivity.refresh.useMutation()
  const projects = trpc.productivity.projects.useQuery()
  const [tab, setTab] = useState<Tab>('overview')
  const [days, setDays] = useState(30)
  const [projectPath, setProjectPath] = useState<string | undefined>(undefined)

  const onRefresh = async () => {
    try {
      const r = await refresh.mutateAsync()
      await utils.productivity.invalidate()
      toast.success(`Ingested ${r.turns} turns`, {
        description: `${r.sessions} sessions, ${r.ecosystem} ecosystem changes`,
      })
    } catch {
      toast.error('Refresh failed')
    }
  }

  const projectList = projects.data ?? []

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Productivity"
        description="Agent token use, complexity, and ecosystem changes."
        action={
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={refresh.isPending}>
            <RefreshCw className={cn('size-4', refresh.isPending && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-col gap-6 p-8">
        <div className="flex flex-wrap items-center gap-3">
          <div
            role="tablist"
            aria-label="Productivity views"
            className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1"
          >
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium text-sm transition-colors',
                  tab === id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Select
              value={projectPath ?? ALL_PROJECTS}
              onValueChange={(v) => setProjectPath(v === ALL_PROJECTS ? undefined : v)}
            >
              <SelectTrigger size="sm" className="w-52" aria-label="Project filter">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
                {projectList.map((p) => (
                  <SelectItem key={p.projectPath} value={p.projectPath}>
                    {p.project}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <fieldset className="inline-flex w-fit gap-1 rounded-lg bg-muted p-1">
              <legend className="sr-only">Time range</legend>
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  aria-pressed={days === r.days}
                  onClick={() => setDays(r.days)}
                  className={cn(
                    'rounded-md px-3 py-1.5 font-medium text-sm tabular-nums transition-colors',
                    days === r.days
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </fieldset>
          </div>
        </div>

        {tab === 'overview' ? <OverviewTab days={days} projectPath={projectPath} /> : null}
        {tab === 'sessions' ? <SessionsTab days={days} projectPath={projectPath} /> : null}
        {tab === 'ecosystem' ? <EcosystemTab days={days} /> : null}
      </div>
    </div>
  )
}
