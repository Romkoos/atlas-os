import { ChartFrame } from '@renderer/components/charts/ChartFrame'
import { kpiMeta, todayByHourMeta, tokensPerDayMeta } from '@renderer/components/charts/chartMeta'
import { dailyDateAxis, overlayPrevious } from '@renderer/components/charts/compareSeries'
import { DayDrawer, type DrawerSession } from '@renderer/components/charts/DayDrawer'
import { inDayRange, localDay } from '@renderer/components/charts/daySessions'
import { HoverSyncProvider, useHoverSync } from '@renderer/components/charts/HoverSyncContext'
import { type BrushRange, brushProps } from '@renderer/components/charts/rangeBrush'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'

type Tab = 'overview' | 'sessions' | 'ecosystem' | 'benchmark'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'overview', label: './overview' },
  { id: 'sessions', label: './sessions' },
  { id: 'ecosystem', label: './ecosystem' },
  { id: 'benchmark', label: './benchmark' },
]

const RANGES: ReadonlyArray<{ days: number; label: string }> = [
  { days: 1, label: '1d' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
]

const ALL_PROJECTS = 'all'

// Stable empty fallback for overview.data?.tokensByDay. A fresh `[]` per render
// would change the chartData useMemo dep on every render during loading,
// defeating memoization. Typed to match the overview router output.
const NO_TOKENS_BY_DAY: { date: string; tokensIn: number; tokensOut: number }[] = []

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
  payload?: {
    payload: {
      tokensIn: number
      tokensOut: number
      event: string | null
      prevTokens?: number | null
    }
  }[]
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
      {row.prevTokens != null ? (
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">prev total</span>
          <span className="tabular-nums">{num(row.prevTokens)}</span>
        </div>
      ) : null}
      {row.event ? (
        <div className="mt-1.5 max-w-56 border-t pt-1.5 text-[var(--color-chart-3)]">
          ⚑ {row.event}
        </div>
      ) : null}
    </div>
  )
}

// KPI-per-day tooltip: Eff value + quality guardrail + session count + ecosystem change.
function KpiTooltip(props: {
  active?: boolean
  label?: string | number
  payload?: {
    payload: {
      kpi: number | null
      quality: number | null
      sessions: number
      event: string | null
      prevKpi?: number | null
    }
  }[]
}) {
  const row = props.payload?.[0]?.payload
  if (!props.active || !row) return null
  return (
    <div style={tooltipStyle} className="px-2.5 py-2 text-xs">
      <div className="mb-1 font-medium">{props.label}</div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Efficiency</span>
        <span className="tabular-nums">{row.kpi == null ? '—' : `${row.kpi.toFixed(0)}%`}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Quality</span>
        <span className="tabular-nums">{row.quality == null ? '—' : row.quality.toFixed(1)}</span>
      </div>
      <div className="flex justify-between gap-6">
        <span className="text-muted-foreground">Sessions</span>
        <span className="tabular-nums">{row.sessions}</span>
      </div>
      {row.prevKpi != null ? (
        <div className="flex justify-between gap-6">
          <span className="text-muted-foreground">prev Eff</span>
          <span className="tabular-nums">{`${row.prevKpi.toFixed(0)}%`}</span>
        </div>
      ) : null}
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

// The two date-axis charts (tokens-per-day + efficiency). Rendered inside a
// HoverSyncProvider so a crosshair on one chart drives the readout on both:
// each chart publishes its hovered category via onMouseMove, and ChartFrame's
// readout (fed the same data) renders the matching day's values.
function DailyCharts({
  chartData,
  kpiChartData,
  eventDays,
  tokensEmpty,
  kpiLoading,
  kpiEmpty,
  rebaseline,
  days,
  projectPath,
  compare,
  onToggleCompare,
  comparePending,
  brushRange,
  onBrushChange,
  onDayClick,
}: {
  chartData: Array<{
    date: string
    tokensIn: number
    tokensOut: number
    event: string | null
    prevTokens: number | null
  }>
  kpiChartData: Array<{
    date: string
    kpi: number | null
    kpiSmooth: number | null
    quality: number | null
    sessions: number
    event: string | null
    prevKpi: number | null
  }>
  eventDays: { date: string; count: number; label: string }[]
  tokensEmpty: boolean
  kpiLoading: boolean
  kpiEmpty: boolean
  rebaseline: ReturnType<typeof trpc.productivity.rebaseline.useMutation>
  days: number
  projectPath?: string
  compare: boolean
  onToggleCompare: () => void
  comparePending: boolean
  brushRange: BrushRange
  onBrushChange: (r: BrushRange) => void
  onDayClick: (day: string) => void
}) {
  const { setActiveDate } = useHoverSync()
  const onMove = (s: { activeLabel?: string | number }) =>
    setActiveDate(s?.activeLabel != null ? String(s.activeLabel) : null)
  const onLeave = () => setActiveDate(null)
  const onBrush = (r: { startIndex?: number; endIndex?: number }) =>
    onBrushChange({ startIndex: r.startIndex, endIndex: r.endIndex })
  const onChartClick = (s: { activeLabel?: string | number }) => {
    if (s?.activeLabel != null) onDayClick(String(s.activeLabel))
  }
  const tokenFmt = (_k: string, v: number) => num(v)
  const kpiFmt = (k: string, v: number) => (k === 'kpi' ? `${v.toFixed(0)}%` : v.toFixed(1))

  return (
    <>
      {/* TOKENS PER DAY */}
      <ChartFrame
        meta={tokensPerDayMeta}
        rows={chartData}
        format={tokenFmt}
        action={
          <button
            type="button"
            className={cn('btn', compare && 'primary')}
            onClick={onToggleCompare}
            disabled={comparePending}
            aria-pressed={compare}
          >
            ◧ COMPARE −{days}d
          </button>
        }
      >
        {(hidden) =>
          tokensEmpty ? (
            <NoteLine>no token activity yet.</NoteLine>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  syncId={tokensPerDayMeta.syncGroup}
                  onMouseMove={onMove}
                  onMouseLeave={onLeave}
                  onClick={onChartClick}
                  margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
                >
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
                  {!hidden.has('tokensIn') ? (
                    <Bar
                      dataKey="tokensIn"
                      stackId="t"
                      fill="var(--color-chart-1)"
                      radius={[0, 0, 0, 0]}
                    />
                  ) : null}
                  {!hidden.has('tokensOut') ? (
                    <Bar
                      dataKey="tokensOut"
                      stackId="t"
                      fill="var(--color-chart-2)"
                      radius={[0, 0, 0, 0]}
                    />
                  ) : null}
                  {compare ? (
                    <Line
                      type="monotone"
                      dataKey="prevTokens"
                      stroke="var(--color-muted-foreground)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  <EcoMarkers events={eventDays} />
                  <Brush
                    {...brushProps}
                    startIndex={brushRange.startIndex}
                    endIndex={brushRange.endIndex}
                    onChange={onBrush}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )
        }
      </ChartFrame>

      {/* TOKEN EFFICIENCY */}
      <ChartFrame
        meta={kpiMeta}
        rows={kpiChartData}
        format={kpiFmt}
        action={
          <button
            type="button"
            className="btn"
            disabled={rebaseline.isPending}
            onClick={() =>
              rebaseline.mutate({
                projectPath,
                start: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
                end: new Date(),
              })
            }
          >
            ↻ RE-BASELINE ({days}d)
          </button>
        }
      >
        {(hidden) =>
          kpiLoading ? (
            <Loading />
          ) : kpiEmpty ? (
            <NoteLine>no efficiency data yet.</NoteLine>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={kpiChartData}
                  syncId={kpiMeta.syncGroup}
                  onMouseMove={onMove}
                  onMouseLeave={onLeave}
                  onClick={onChartClick}
                  margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
                >
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
                    yAxisId="kpi"
                    domain={[0, 'auto']}
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    width={44}
                    tickFormatter={(value: number) => `${value}%`}
                  />
                  <YAxis
                    yAxisId="quality"
                    orientation="right"
                    domain={[0, 10]}
                    tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                    stroke="var(--color-border)"
                    width={32}
                  />
                  <ReferenceLine
                    yAxisId="kpi"
                    y={100}
                    stroke="var(--color-muted-foreground)"
                    strokeDasharray="4 4"
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--color-muted)', strokeWidth: 1 }}
                    content={<KpiTooltip />}
                  />
                  {!hidden.has('kpi') ? (
                    <>
                      {/* raw daily Eff — faint context (noisy by nature) */}
                      <Line
                        yAxisId="kpi"
                        type="monotone"
                        dataKey="kpi"
                        stroke="var(--color-chart-1)"
                        strokeOpacity={0.25}
                        strokeWidth={1}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                      {/* 7-day trailing median — the readable trend line */}
                      <Line
                        yAxisId="kpi"
                        type="monotone"
                        dataKey="kpiSmooth"
                        stroke="var(--color-chart-1)"
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                        isAnimationActive={false}
                      />
                    </>
                  ) : null}
                  {!hidden.has('quality') ? (
                    <Line
                      yAxisId="quality"
                      type="monotone"
                      dataKey="quality"
                      stroke="var(--color-chart-2)"
                      strokeWidth={2}
                      strokeDasharray="5 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  {compare ? (
                    <Line
                      yAxisId="kpi"
                      type="monotone"
                      dataKey="prevKpi"
                      stroke="var(--color-muted-foreground)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      dot={false}
                      connectNulls
                      isAnimationActive={false}
                    />
                  ) : null}
                  <EcoMarkers events={eventDays} />
                  <Brush
                    {...brushProps}
                    startIndex={brushRange.startIndex}
                    endIndex={brushRange.endIndex}
                    onChange={onBrush}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        }
      </ChartFrame>
    </>
  )
}

function OverviewTab({ days, projectPath }: Scope) {
  const utils = trpc.useUtils()
  const overview = trpc.productivity.overview.useQuery({ days, projectPath })
  const usage = trpc.productivity.toolSkillUsage.useQuery({ days, projectPath })
  const co = trpc.productivity.coOccurrence.useQuery({ days, projectPath })
  const ecoDays = trpc.productivity.ecosystemDays.useQuery({ days })
  const today = trpc.productivity.today.useQuery({ projectPath })
  const kpi = trpc.productivity.kpi.useQuery({ days, projectPath })

  const [compare, setCompare] = useState(false)
  const [brushRange, setBrushRange] = useState<BrushRange>({})
  const [drawerDay, setDrawerDay] = useState<string | null>(null)

  // Sessions for the drilldown drawer — fetched only while open, same window as
  // the charts so a clicked (in-window) day is always covered.
  const daySessions = trpc.productivity.sessions.useQuery(
    { days, projectPath },
    { enabled: drawerDay != null },
  )

  // Sessions whose local activity-day range includes the clicked day.
  const drawerRows = useMemo<DrawerSession[]>(() => {
    if (drawerDay == null) return []
    return (daySessions.data ?? [])
      .filter((s) => inDayRange(drawerDay, localDay(s.startedAt), localDay(s.endedAt)))
      .map((s) => ({
        sessionId: s.sessionId,
        project: s.project,
        projectPath: s.projectPath,
        totalTokens: s.totalTokens,
        kpi: s.kpi,
        complexity: s.complexity,
        turnCount: s.turnCount,
        summary: s.summary,
      }))
  }, [drawerDay, daySessions.data])

  // Previous period = same window shifted back by `days`. Only fetched while
  // compare is on, so the toggle is the on/off switch for both ghost lines.
  const overviewPrev = trpc.productivity.overview.useQuery(
    { days, projectPath, offset: days },
    { enabled: compare },
  )
  const kpiPrev = trpc.productivity.kpi.useQuery(
    { days, projectPath, offset: days },
    { enabled: compare },
  )

  const rebaseline = trpc.productivity.rebaseline.useMutation({
    onSuccess: async (r) => {
      toast.success(r.ok ? `Re-baselined (${r.method})` : 'Not enough data to baseline')
      await utils.productivity.invalidate()
    },
    onError: () => toast.error('Re-baseline failed'),
  })

  const tokensByDay = overview.data?.tokensByDay ?? NO_TOKENS_BY_DAY

  // Ecosystem events are global; the daily bars are scoped (project/tracked
  // filter). So an event day may have no bar in scope. Union both date sets and
  // zero-fill tokens, so the category always exists and a marker can be drawn.
  // Hooks must run unconditionally, so these memos precede the early returns below.
  // One ordered date axis shared by both daily charts so the lifted brush index
  // maps to the same day on each. Union of token days, kpi days, and eco days.
  const dailyDates = useMemo(
    () => dailyDateAxis(tokensByDay, kpi.data?.byDay ?? [], ecoDays.data ?? []),
    [tokensByDay, kpi.data, ecoDays.data],
  )

  // Tokens per day over the shared axis. When compare is on, overlay the
  // previous period's total tokens (in+out) positionally as `prevTokens`.
  const chartData = useMemo(() => {
    const ecoMap = new Map((ecoDays.data ?? []).map((e) => [e.date, e] as const))
    const tokMap = new Map(tokensByDay.map((d) => [d.date, d] as const))
    const base = dailyDates.map((date) => ({
      date,
      tokensIn: tokMap.get(date)?.tokensIn ?? 0,
      tokensOut: tokMap.get(date)?.tokensOut ?? 0,
      event: ecoMap.get(date)?.label ?? null,
      prevTokens: null as number | null,
    }))
    if (!compare) return base
    const prevTotals = (overviewPrev.data?.tokensByDay ?? []).map((d) => d.tokensIn + d.tokensOut)
    return overlayPrevious(base, 'prevTokens', prevTotals)
  }, [dailyDates, ecoDays.data, tokensByDay, compare, overviewPrev.data])

  // Eff per day over the shared axis. When compare is on, overlay the previous
  // period's Eff positionally as `prevKpi`. connectNulls bridges gap days.
  const kpiChartData = useMemo(() => {
    const ecoMap = new Map((ecoDays.data ?? []).map((e) => [e.date, e] as const))
    const kpiByDate = new Map((kpi.data?.byDay ?? []).map((d) => [d.date, d] as const))
    const base = dailyDates.map((date) => ({
      date,
      kpi: kpiByDate.get(date)?.kpi ?? null,
      kpiSmooth: kpiByDate.get(date)?.kpiSmooth ?? null,
      quality: kpiByDate.get(date)?.quality ?? null,
      sessions: kpiByDate.get(date)?.sessions ?? 0,
      event: ecoMap.get(date)?.label ?? null,
      prevKpi: null as number | null,
    }))
    if (!compare) return base
    const prevKpis = (kpiPrev.data?.byDay ?? []).map((d) => d.kpi)
    return overlayPrevious(base, 'prevKpi', prevKpis)
  }, [dailyDates, ecoDays.data, kpi.data, compare, kpiPrev.data])

  // Reset the brush when the axis length changes (range toggle / project switch)
  // so stale indices can't point past the new data.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset keyed on length only
  useEffect(() => {
    setBrushRange({})
  }, [dailyDates.length])

  if (overview.isLoading) return <Loading />
  if (overview.isError)
    return (
      <p
        style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warn)', padding: '16px 0' }}
      >
        <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>failed to load overview.
      </p>
    )

  const byProject = overview.data?.byProject ?? []
  const totals = overview.data?.totals

  if (!totals || (totals.turns === 0 && tokensByDay.length === 0)) return <EmptyHint />

  const tools = usage.data?.tools ?? []
  const skills = usage.data?.skills ?? []

  const eventDays = ecoDays.data ?? []

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
            <span className="id">[05]</span>TOKEN EFFICIENCY
          </div>
          <div className="val amber">{pct(kpi.data?.overall ?? null)}</div>
          <div className="delta">vs baseline</div>
        </div>
      </div>

      {/* TODAY BY HOUR */}
      <ChartFrame meta={todayByHourMeta}>
        {(hidden) =>
          today.isLoading ? (
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
                    {!hidden.has('tokensIn') ? (
                      <Bar dataKey="tokensIn" stackId="t" fill="var(--color-chart-1)" />
                    ) : null}
                    {!hidden.has('tokensOut') ? (
                      <Bar
                        dataKey="tokensOut"
                        stackId="t"
                        fill="var(--color-chart-2)"
                        radius={[0, 0, 0, 0]}
                      />
                    ) : null}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )
        }
      </ChartFrame>

      {/* TOKENS PER DAY + efficiency — synced crosshair + readout */}
      <HoverSyncProvider>
        <DailyCharts
          chartData={chartData}
          kpiChartData={kpiChartData}
          eventDays={eventDays}
          tokensEmpty={tokensByDay.length === 0}
          kpiLoading={kpi.isLoading}
          kpiEmpty={(kpi.data?.byDay.length ?? 0) === 0}
          rebaseline={rebaseline}
          days={days}
          projectPath={projectPath}
          compare={compare}
          onToggleCompare={() => setCompare((v) => !v)}
          comparePending={compare && (overviewPrev.isFetching || kpiPrev.isFetching)}
          brushRange={brushRange}
          onBrushChange={setBrushRange}
          onDayClick={setDrawerDay}
        />
      </HoverSyncProvider>

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
      <DayDrawer
        day={drawerDay}
        sessions={drawerRows}
        loading={daySessions.isLoading}
        onClose={() => setDrawerDay(null)}
      />
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
            <th className="num">Eff</th>
            <th>difficulty</th>
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
                title="Token Efficiency vs frozen baseline — 100% = baseline efficiency, higher is leaner"
              >
                {pct(s.kpi)}
              </td>
              <td>
                <DifficultyControl sessionId={s.sessionId} difficulty={s.difficulty} />
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
      <option value="">—</option>
      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  )
}

function DifficultyControl({
  sessionId,
  difficulty,
}: {
  sessionId: string
  difficulty: number | null
}) {
  const utils = trpc.useUtils()
  const setDifficulty = trpc.productivity.setDifficulty.useMutation({
    onSuccess: async () => {
      await utils.productivity.invalidate()
    },
    onError: () => toast.error('Failed to save difficulty'),
  })
  return (
    <select
      aria-label={`Task difficulty for session ${sessionId}`}
      className="select tabular-nums"
      style={{ width: 72 }}
      value={difficulty ?? ''}
      disabled={setDifficulty.isPending}
      onChange={(e) => {
        const v = e.target.value === '' ? null : Number(e.target.value)
        setDifficulty.mutate({ sessionId, difficulty: v })
      }}
    >
      <option value="">—</option>
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
// 'up' = higher is better (Eff). The "good" direction is green, the other red.
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
  const deleteNote = trpc.productivity.deleteNote.useMutation()
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

  const removeNote = async (id: string) => {
    try {
      await deleteNote.mutateAsync({ id })
      await utils.productivity.invalidate()
      toast.success('Note deleted')
    } catch {
      toast.error('Failed to delete note')
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
            7d before vs after · global · tok/turn lower = better · Eff higher = better
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
                  <th className="num">Eff before</th>
                  <th className="num">after</th>
                  <th className="num">Δ Eff</th>
                  <th className="num">Δ quality</th>
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
                    <td className="num">{tpt(r.tokPerTurnBefore)}</td>
                    <td className="num">{tpt(r.tokPerTurnAfter)}</td>
                    <td className="num">
                      <ImpactDelta pct={r.tokPerTurnDeltaPct} />
                    </td>
                    <td className="num">{pct(r.kpiBefore)}</td>
                    <td className="num">{pct(r.kpiAfter)}</td>
                    <td className="num">
                      <ImpactDelta pct={r.kpiDeltaPct} goodDirection="up" />
                    </td>
                    <td className="num">
                      {r.qualityDelta == null ? (
                        <span style={{ color: 'var(--fg-4)' }}>—</span>
                      ) : (
                        <span
                          className="tabular-nums"
                          style={{
                            color:
                              r.qualityDelta > 0
                                ? 'var(--ok)'
                                : r.qualityDelta < 0
                                  ? 'var(--warn)'
                                  : 'var(--fg-4)',
                          }}
                        >
                          {r.qualityDelta > 0 ? '+' : ''}
                          {r.qualityDelta.toFixed(1)}
                        </span>
                      )}
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
              Windows with no activity on a side show —.
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
                  {c.source === 'manual' ? (
                    <button
                      type="button"
                      onClick={() => removeNote(c.id)}
                      disabled={deleteNote.isPending}
                      title="Delete note"
                      aria-label="Delete note"
                      style={{
                        flexShrink: 0,
                        alignSelf: 'flex-start',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--fg-4)',
                        fontFamily: 'var(--mono)',
                        fontSize: 14,
                        lineHeight: 1,
                        padding: '0 2px',
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </>
  )
}

function BenchmarkTab() {
  const utils = trpc.useUtils()
  const tasks = trpc.benchmark.tasks.useQuery()
  const results = trpc.benchmark.results.useQuery()
  const [batchId, setBatchId] = useState<string | null>(null)
  const [k, setK] = useState(5)
  const [model, setModel] = useState('claude-sonnet-4-6')

  // A batch runs in the main process; batchId lives in this component's state and
  // is lost when the tab unmounts. On (re)mount, re-attach to the most recent batch
  // so progress survives navigation. Polls while one is still running.
  const latest = trpc.benchmark.latest.useQuery(undefined, {
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  })

  const progress = trpc.benchmark.progress.useQuery(
    { batchId: batchId ?? '' },
    {
      enabled: batchId != null,
      refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
    },
  )

  // Adopt the latest batch when this component isn't already tracking one.
  useEffect(() => {
    if (batchId == null && latest.data?.batchId) setBatchId(latest.data.batchId)
  }, [latest.data, batchId])

  const run = trpc.benchmark.run.useMutation({
    onSuccess: (r) => {
      setBatchId(r.batchId)
      toast.success(`Benchmark started: ${r.total} runs`)
    },
  })

  // Live progress from either query; refresh the results table when a batch ends.
  const liveProgress = progress.data ?? latest.data ?? null
  const running = liveProgress?.running ?? false
  useEffect(() => {
    if (liveProgress && !liveProgress.running) void utils.benchmark.results.invalidate()
  }, [liveProgress, utils])

  const taskCount = tasks.data?.length ?? 0
  const estimated = taskCount * k

  return (
    <>
      <div className="panel mt-16">
        <div className="panel-head">
          <span className="ttl">run benchmark</span>
          <span className="meta">
            fixed tasks on real claude headless under current infra · spends tokens
          </span>
        </div>
        <div className="panel-body">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
            <label className="bench-field">
              <span>model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="input"
                style={{ width: 220 }}
                aria-label="Model"
              />
            </label>
            <label className="bench-field">
              <span>reps (k)</span>
              <input
                type="number"
                min={1}
                max={20}
                value={k}
                onChange={(e) => setK(Number(e.target.value) || 1)}
                className="input"
                style={{ width: 80 }}
                aria-label="Reps per task"
              />
            </label>
            <button
              type="button"
              className="btn primary"
              disabled={running || run.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Run ${estimated} real claude runs (${taskCount} tasks × ${k})? This spends tokens.`,
                  )
                ) {
                  run.mutate({ k, model })
                }
              }}
            >
              {running ? 'RUNNING…' : `RUN BENCHMARK (${estimated})`}
            </button>
            {liveProgress ? (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
                {liveProgress.done}/{liveProgress.total} done · {liveProgress.failed} failed
                {liveProgress.running ? ' · running…' : ''}
              </span>
            ) : null}
          </div>
          {liveProgress?.error ? (
            <p
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 11,
                color: 'var(--warn)',
                marginTop: 12,
              }}
            >
              <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
              {liveProgress.error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="panel mt-16">
        <div className="panel-head">
          <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <span className="ttl">results</span>
            <span className="meta">
              median total tokens (incl cached infra prefix) · k reps · lower = better
            </span>
          </span>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 10 }}
            onClick={() => void utils.benchmark.results.invalidate()}
          >
            REFRESH
          </button>
        </div>
        {results.isLoading ? (
          <div className="panel-body">
            <Loading />
          </div>
        ) : (results.data ?? []).length === 0 ? (
          <div className="panel-body">
            <NoteLine>no benchmark runs yet — run one above.</NoteLine>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>task</th>
                <th>infra</th>
                <th>model</th>
                <th className="num">n</th>
                <th className="num">median tokens</th>
                <th className="num">cached</th>
                <th className="num">spread</th>
                <th className="num">median cost</th>
              </tr>
            </thead>
            <tbody>
              {(results.data ?? []).map((r) => (
                <tr key={`${r.taskId}-${r.infraHash}-${r.model}`}>
                  <td>{r.taskId}</td>
                  <td style={{ color: 'var(--fg-4)' }}>{r.infraHash}</td>
                  <td style={{ color: 'var(--fg-4)' }}>{r.model}</td>
                  <td className="num">{r.n}</td>
                  <td className="num">{r.n === 0 ? '—' : num(Math.round(r.medianTokens))}</td>
                  <td className="num" style={{ color: 'var(--fg-4)' }}>
                    {r.n === 0 ? '—' : num(Math.round(r.medianCacheTokens))}
                  </td>
                  <td className="num">{r.n === 0 ? '—' : num(Math.round(r.spreadTokens))}</td>
                  <td className="num">{r.n === 0 ? '—' : `$${r.medianCostUsd.toFixed(4)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
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
        {tab === 'benchmark' ? <BenchmarkTab /> : null}
      </div>
    </>
  )
}
