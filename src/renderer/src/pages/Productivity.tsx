import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'
import { type ReactNode, useState } from 'react'
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
  { id: 'overview', label: './overview' },
  { id: 'sessions', label: './sessions' },
  { id: 'ecosystem', label: './ecosystem' },
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
const pct = (v: number | null, digits = 0): string => (v == null ? '—' : `${v.toFixed(digits)}%`)
const scoreLabel = (avg: number | null, rated: number, total: number): string =>
  rated === 0 ? '—' : `${avg == null ? '—' : avg.toFixed(1)} · ${rated}/${total} rated`
// Dates cross IPC as real Date objects (structured clone), but tRPC's transformer-less
// type inference reports them as string — accept both and normalize.
const fmtDate = (d: Date | string | null): string => (d ? new Date(d).toLocaleString() : '—')

const tooltipStyle = {
  background: 'var(--color-popover)',
  border: '1px solid var(--color-border)',
  borderRadius: 0,
  fontSize: 12,
  color: 'var(--color-popover-foreground)',
}

// Terminal-style empty hint: a single panel with mono "// no data" text.
function EmptyHint() {
  return (
    <div className="panel mt-16">
      <div className="panel-body">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)' }}>
          <div style={{ color: 'var(--fg-3)', marginBottom: 8 }}>
            <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>no data in this range.
          </div>
          <div style={{ lineHeight: 1.7 }}>
            Widen the range, clear the project filter, or refresh after using Claude Code.
          </div>
        </div>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)', padding: '16px 0' }}>
      <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>loading…
    </p>
  )
}

// Mono "// message" line used for per-panel empty states.
function NoteLine({ children }: { children: ReactNode }) {
  return (
    <p style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)', padding: '8px 0' }}>
      <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
      {children}
    </p>
  )
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
        <span className="tabular-nums">{row.kpi == null ? '—' : `${row.kpi.toFixed(0)}%`}</span>
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

// Compact horizontal bar list for tool/skill usage frequency, rendered as
// terminal .barrow rows. `cols` overrides the row grid (e.g. for wide pair names).
function UsageList({ items, cols }: { items: { name: string; count: number }[]; cols?: string }) {
  const top = items.slice(0, 10)
  const max = top.reduce((m, i) => Math.max(m, i.count), 0) || 1
  return (
    <>
      {top.map((item, i) => (
        <div
          key={item.name}
          className="barrow"
          style={cols ? { gridTemplateColumns: cols } : undefined}
        >
          <div className="name" title={item.name}>
            <span style={{ color: 'var(--fg-4)' }}>{String(i + 1).padStart(2, '0')}</span>
            &nbsp; {item.name}
          </div>
          <div className="bar-wrap">
            <div
              className={cn('bar', i > 2 && 'dim')}
              style={{ width: `${(item.count / max) * 100}%` }}
            />
          </div>
          <div className="v">{item.count}</div>
        </div>
      ))}
    </>
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
    return (
      <p
        style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warn)', padding: '16px 0' }}
      >
        <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>failed to load overview.
      </p>
    )

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
    <>
      <div className="kpis k5 mt-16">
        <div className="kpi">
          <div className="label">
            <span className="id">[01]</span>TOTAL TOKENS
          </div>
          <div className="val">{num(totals.totalTokens)}</div>
          <div className="delta">{num(totals.turns)} turns</div>
        </div>
        <div className="kpi">
          <div className="label">
            <span className="id">[02]</span>SESSIONS
          </div>
          <div className="val">{num(totals.sessions)}</div>
          <div className="delta">{num(totals.totalCount)} total</div>
        </div>
        <div className="kpi">
          <div className="label">
            <span className="id">[03]</span>AVG SCORE (RATED)
          </div>
          <div className="val">
            {scoreLabel(totals.avgScore, totals.ratedCount, totals.totalCount)}
          </div>
          <div className="delta">
            {totals.ratedCount} / {totals.totalCount} rated
          </div>
        </div>
        <div className="kpi">
          <div className="label">
            <span className="id">[04]</span>AVG COMPLEXITY
          </div>
          <div className="val">{dash(totals.avgComplexity)}</div>
          <div className="delta">per session</div>
        </div>
        <div className="kpi">
          <div className="label">
            <span className="id">[05]</span>KPI · EFFICIENCY
          </div>
          <div className="val amber">{pct(kpi.data?.overall ?? null)}</div>
          <div className="delta">percentile</div>
        </div>
      </div>

      {/* TODAY BY HOUR */}
      <div className="panel mt-16">
        <div className="panel-head">
          <span className="ttl">today by hour</span>
          <span className="meta">current local day · ignores range above</span>
        </div>
        <div className="panel-body">
          {today.isLoading ? (
            <Loading />
          ) : !today.data || today.data.totals.turns === 0 ? (
            <NoteLine>no activity yet today.</NoteLine>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px 24px',
                  marginBottom: 12,
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--fg-4)',
                }}
              >
                <span>
                  <span style={{ color: 'var(--fg)' }} className="tabular-nums">
                    {num(today.data.totals.totalTokens)}
                  </span>{' '}
                  tokens
                </span>
                <span>
                  <span style={{ color: 'var(--fg)' }} className="tabular-nums">
                    {num(today.data.totals.turns)}
                  </span>{' '}
                  turns
                </span>
                <span>
                  <span style={{ color: 'var(--fg)' }} className="tabular-nums">
                    {num(today.data.totals.sessions)}
                  </span>{' '}
                  sessions
                </span>
                <span>
                  <span style={{ color: 'var(--fg)' }} className="tabular-nums">
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
                      radius={[0, 0, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>

      {/* TOKENS PER DAY */}
      <div className="panel mt-16">
        <div className="panel-head">
          <span className="ttl">tokens per day</span>
          <span className="meta">
            {(ecoDays.data?.length ?? 0) > 0
              ? 'dashed lines mark ecosystem changes · hover bar for details'
              : 'input + output per day'}
          </span>
        </div>
        <div className="panel-body">
          {tokensByDay.length === 0 ? (
            <NoteLine>no token activity yet.</NoteLine>
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
                    radius={[0, 0, 0, 0]}
                  />
                  <EcoMarkers events={eventDays} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* KPI (EFFICIENCY) */}
      <div className="panel mt-16">
        <div className="panel-head">
          <span className="ttl">KPI · efficiency</span>
          <span className="meta">
            quality × complexity per token · percentile · avg per day
            {(ecoDays.data?.length ?? 0) > 0 ? ' · ⚑ ecosystem changes' : ''}
          </span>
        </div>
        <div className="panel-body">
          {kpi.isLoading ? (
            <Loading />
          ) : (kpi.data?.byDay.length ?? 0) === 0 ? (
            <NoteLine>no KPI data yet.</NoteLine>
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
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    width={44}
                    tickFormatter={(value: number) => `${value}%`}
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
        </div>
      </div>

      {/* PROJECTS */}
      <div className="panel mt-16">
        <div className="panel-head">
          <span className="ttl">by project</span>
          <span className="meta">{byProject.length} tracked · sort: tokens ↓</span>
        </div>
        {byProject.length === 0 ? (
          <div className="panel-body">
            <NoteLine>no projects in range.</NoteLine>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>project</th>
                <th className="num">tokens</th>
                <th className="num">turns</th>
                <th className="num">sessions</th>
                <th className="num">complexity</th>
              </tr>
            </thead>
            <tbody>
              {byProject.map((p, i) => (
                <tr key={p.projectPath}>
                  <td>
                    <span style={{ color: 'var(--fg-4)' }}>{String(i + 1).padStart(2, '0')}</span>
                    &nbsp;&nbsp;
                    <span
                      style={{ color: i === 0 ? 'var(--amber)' : 'var(--fg)' }}
                      title={p.projectPath}
                    >
                      {p.project}
                    </span>
                  </td>
                  <td className="num">{num(p.totalTokens)}</td>
                  <td className="num">{num(p.turns)}</td>
                  <td className="num">{num(p.sessions)}</td>
                  <td className="num">{dash(p.avgComplexity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* TOP TOOLS / TOP SKILLS */}
      <div className="grid-2 mt-16">
        <div className="panel">
          <div className="panel-head">
            <span className="ttl">top tools</span>
            <span className="meta">invocations</span>
          </div>
          <div className="panel-body">
            {usage.isLoading ? (
              <Loading />
            ) : tools.length === 0 ? (
              <NoteLine>no tools recorded yet.</NoteLine>
            ) : (
              <UsageList items={tools} />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="ttl">top skills</span>
            <span className="meta">invocations</span>
          </div>
          <div className="panel-body">
            {usage.isLoading ? (
              <Loading />
            ) : skills.length === 0 ? (
              <NoteLine>no skills recorded yet.</NoteLine>
            ) : (
              <UsageList items={skills} />
            )}
          </div>
        </div>
      </div>

      {/* TOOLS / SKILLS TOGETHER */}
      <div className="grid-2 mt-16">
        <div className="panel">
          <div className="panel-head">
            <span className="ttl">tools used together</span>
            <span className="meta">pairs co-occurring · same turn</span>
          </div>
          <div className="panel-body">
            {co.isLoading ? (
              <Loading />
            ) : (co.data?.toolPairs.length ?? 0) === 0 ? (
              <NoteLine>no tool pairs yet.</NoteLine>
            ) : (
              <UsageList items={co.data?.toolPairs ?? []} cols="180px 1fr 56px" />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="ttl">skills used together</span>
            <span className="meta">pairs co-occurring · same turn</span>
          </div>
          <div className="panel-body">
            {co.isLoading ? (
              <Loading />
            ) : (co.data?.skillPairs.length ?? 0) === 0 ? (
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 11,
                  color: 'var(--fg-4)',
                  padding: '12px 0',
                }}
              >
                <div style={{ color: 'var(--fg-3)', marginBottom: 8 }}>
                  <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>no skill pairs yet.
                </div>
                <div style={{ lineHeight: 1.7 }}>
                  Skills usually fire one at a time. Run more sessions where a single skill triggers
                  multiple sub-skills to populate this view.
                </div>
              </div>
            ) : (
              <UsageList items={co.data?.skillPairs ?? []} cols="180px 1fr 56px" />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

const SESSIONS_PAGE_SIZE = 25

function SessionsTab({ days, projectPath }: Scope) {
  const sessions = trpc.productivity.sessions.useQuery({ days, projectPath })
  const [page, setPage] = useState(0)

  if (sessions.isLoading) return <Loading />
  if (sessions.isError)
    return (
      <p
        style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warn)', padding: '16px 0' }}
      >
        <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>failed to load sessions.
      </p>
    )

  // Rows arrive newest-first from the router (ordered by startedAt desc).
  const rows = sessions.data ?? []
  if (rows.length === 0) return <EmptyHint />

  const pageCount = Math.ceil(rows.length / SESSIONS_PAGE_SIZE)
  const current = Math.min(page, pageCount - 1) // clamp if scope shrank the list
  const start = current * SESSIONS_PAGE_SIZE
  const pageRows = rows.slice(start, start + SESSIONS_PAGE_SIZE)

  return (
    <div className="panel mt-16">
      <div className="panel-head">
        <span className="ttl">sessions</span>
        <span className="meta">{rows.length} in range · newest first</span>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>project</th>
            <th>started</th>
            <th className="num">turns</th>
            <th className="num">tokens</th>
            <th className="num">complexity</th>
            <th className="num">KPI</th>
            <th>rating</th>
            <th>summary</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((s) => (
            <tr key={s.sessionId}>
              <td>
                <span title={s.projectPath}>{s.project}</span>
              </td>
              <td className="whitespace-nowrap" style={{ color: 'var(--fg-4)' }}>
                {fmtDate(s.startedAt)}
              </td>
              <td className="num">{num(s.turnCount)}</td>
              <td className="num">{num(s.totalTokens)}</td>
              <td
                className="num"
                title={`files ${s.distinctFiles} · dirs ${s.distinctDirs} · tools ${s.distinctTools} · skills ${s.distinctSkills} · subagents ${s.subagentCount}`}
              >
                {dash(s.complexity, 1)}
              </td>
              <td
                className="num"
                title="Efficiency percentile across all sessions — higher is more efficient"
              >
                {pct(s.kpi)}
              </td>
              <td>
                <RatingControl sessionId={s.sessionId} score={s.score} />
              </td>
              <td style={{ maxWidth: '20rem' }}>
                <span
                  className="line-clamp-2"
                  style={{ color: 'var(--fg-3)' }}
                  title={s.summary ?? ''}
                >
                  {s.summary ?? '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pageCount > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 14px',
            borderTop: '1px solid var(--line-dim)',
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--fg-4)',
          }}
        >
          <span className="tabular-nums">
            {start + 1}–{Math.min(start + SESSIONS_PAGE_SIZE, rows.length)} of {rows.length}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="button"
              className="btn"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              ← PREV
            </button>
            <span className="tabular-nums">
              page {current + 1} / {pageCount}
            </span>
            <button
              type="button"
              className="btn"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              NEXT →
            </button>
          </div>
        </div>
      )}
    </div>
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
      className="select tabular-nums"
      style={{ width: 72 }}
      value={score ?? ''}
      disabled={setRating.isPending}
      onChange={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value)
        setRating.mutate({ sessionId, score: v })
      }}
    >
      <option value="">— (5.5)</option>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  )
}

// Small mono bordered badge for ecosystem change types.
function EcoBadge({ type }: { type: string }) {
  return (
    <span
      style={{
        flexShrink: 0,
        border: '1px solid var(--line)',
        color: 'var(--fg-3)',
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: '0.04em',
        padding: '1px 6px',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {type.replace(/_/g, ' ')}
    </span>
  )
}

// Delta colouring. goodDirection='down' (default) = lower is better (tokens/turn);
// 'up' = higher is better (KPI). The "good" direction is green, the other red.
function ImpactDelta({
  pct,
  goodDirection = 'down',
}: {
  pct: number | null
  goodDirection?: 'up' | 'down'
}) {
  if (pct == null) return <span style={{ color: 'var(--fg-4)' }}>—</span>
  const sign = pct > 0 ? '+' : ''
  const good = goodDirection === 'down' ? pct < 0 : pct > 0
  const color = pct === 0 ? 'var(--fg-4)' : good ? 'var(--ok)' : 'var(--warn)'
  return (
    <span className="tabular-nums" style={{ color }}>
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
    return (
      <p
        style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warn)', padding: '16px 0' }}
      >
        <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>failed to load ecosystem.
      </p>
    )

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
    <>
      {/* MARK A CHANGE */}
      <div className="panel mt-16">
        <div className="panel-head">
          <span className="ttl">mark a change</span>
          <span className="meta">becomes a dashed line on tokens/day + a change-impact row</span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="input"
              style={{ width: 160 }}
              aria-label="Change date"
            />
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNote()
              }}
              placeholder="What changed? e.g. Added context7 MCP"
              className="input"
              style={{ minWidth: 224, flex: 1 }}
              aria-label="Change note"
            />
            <button
              type="button"
              className="btn primary"
              onClick={submitNote}
              disabled={addNote.isPending || !note.trim()}
            >
              ADD NOTE
            </button>
          </div>
        </div>
      </div>

      {/* CHANGE IMPACT */}
      <div className="panel mt-16">
        <div className="panel-head">
          <span className="ttl">change impact</span>
          <span className="meta">
            7d before vs after · global · tok/turn lower = better · KPI higher = better
          </span>
        </div>
        {impact.isLoading ? (
          <div className="panel-body">
            <Loading />
          </div>
        ) : impactRows.length === 0 ? (
          <div className="panel-body">
            <NoteLine>no changes in the last 60 days.</NoteLine>
          </div>
        ) : (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th>when</th>
                  <th>change</th>
                  <th className="num">tok/turn before</th>
                  <th className="num">after</th>
                  <th className="num">Δ tok</th>
                  <th className="num">KPI before</th>
                  <th className="num">after</th>
                  <th className="num">Δ KPI</th>
                </tr>
              </thead>
              <tbody>
                {impactRows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap" style={{ color: 'var(--fg-4)' }}>
                      {fmtDate(r.ts)}
                    </td>
                    <td>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <EcoBadge type={r.type} />
                        <span className="min-w-0 truncate" title={r.target ?? ''}>
                          {r.target ?? '—'}
                        </span>
                      </span>
                    </td>
                    <td className="num">
                      {tpt(r.tokPerTurnBefore)}
                      <span style={{ color: 'var(--fg-4)', marginLeft: 4, fontSize: 10 }}>
                        ({r.turnsBefore})
                      </span>
                    </td>
                    <td className="num">
                      {tpt(r.tokPerTurnAfter)}
                      <span style={{ color: 'var(--fg-4)', marginLeft: 4, fontSize: 10 }}>
                        ({r.turnsAfter})
                      </span>
                    </td>
                    <td className="num">
                      <ImpactDelta pct={r.deltaPct} />
                    </td>
                    <td className="num">{pct(r.kpiBefore)}</td>
                    <td className="num">{pct(r.kpiAfter)}</td>
                    <td className="num">
                      <ImpactDelta pct={r.kpiDeltaPct} goodDirection="up" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p
              style={{
                padding: '10px 14px',
                fontFamily: 'var(--mono)',
                fontSize: 10,
                color: 'var(--fg-4)',
                borderTop: '1px solid var(--line-dim)',
              }}
            >
              (n) = turns in each window. Rows with no turns on a side show —.
            </p>
          </>
        )}
      </div>

      {/* ECOSYSTEM CHANGES */}
      <div className="panel mt-16">
        <div className="panel-head">
          <span className="ttl">ecosystem changes</span>
          <span className="meta">global · not affected by the project filter</span>
        </div>
        <div className="panel-body">
          {rows.length === 0 ? (
            <NoteLine>
              no ecosystem changes yet. Install the agent-analytics hooks or add a note above.
            </NoteLine>
          ) : (
            <ol style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {rows.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: 'flex',
                    gap: 12,
                    paddingBottom: 12,
                    borderBottom: '1px solid var(--line-dim)',
                  }}
                >
                  <span
                    style={{
                      width: 150,
                      flexShrink: 0,
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      color: 'var(--fg-4)',
                    }}
                    className="tabular-nums"
                  >
                    {fmtDate(c.ts)}
                  </span>
                  <EcoBadge type={c.type} />
                  <span
                    style={{
                      minWidth: 0,
                      flex: 1,
                      wordBreak: 'break-word',
                      fontSize: 13,
                      color: 'var(--fg-2)',
                    }}
                  >
                    {c.target ?? c.note ?? '—'}
                    {c.target && c.note ? (
                      <span style={{ color: 'var(--fg-4)' }}> — {c.note}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
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
    <>
      <PageHeader
        num="03"
        title="PRODUCTIVITY"
        description={
          <>
            Agent token use, complexity, and ecosystem changes. Hover any bar in{' '}
            <span style={{ color: 'var(--amber)' }}>tokens/day</span> for the breakdown.
          </>
        }
        action={
          <>
            <select
              className="select"
              value={projectPath ?? ALL_PROJECTS}
              onChange={(e) =>
                setProjectPath(e.target.value === ALL_PROJECTS ? undefined : e.target.value)
              }
              aria-label="Project filter"
            >
              <option value={ALL_PROJECTS}>all projects · {projectList.length}</option>
              {projectList.map((p) => (
                <option key={p.projectPath} value={p.projectPath}>
                  {p.project}
                </option>
              ))}
            </select>
            <div className="seg">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  className={days === r.days ? 'on' : ''}
                  onClick={() => setDays(r.days)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button type="button" className="btn" onClick={onRefresh} disabled={refresh.isPending}>
              ↻ REFRESH
            </button>
          </>
        }
      />

      <div className="scroll">
        <div className="tabs">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'on' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' ? <OverviewTab days={days} projectPath={projectPath} /> : null}
        {tab === 'sessions' ? <SessionsTab days={days} projectPath={projectPath} /> : null}
        {tab === 'ecosystem' ? <EcosystemTab days={days} /> : null}
      </div>
    </>
  )
}
