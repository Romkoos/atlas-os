import { BenchmarkWidget } from '@renderer/components/dashboard/BenchmarkWidget'
import {
  compact,
  DrillLink,
  Note,
  num,
  pct,
  timeAgo,
} from '@renderer/components/dashboard/dash-utils'
import { GalaxyHero } from '@renderer/components/dashboard/GalaxyHero'
import { KnowledgePulse } from '@renderer/components/dashboard/KnowledgePulse'
import { ProcessesStrip } from '@renderer/components/dashboard/ProcessesStrip'
import { RoadmapNextUp } from '@renderer/components/dashboard/RoadmapNextUp'
import { Sparkline } from '@renderer/components/dashboard/Sparkline'
import { TokenHeatmap } from '@renderer/components/dashboard/TokenHeatmap'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { Ticker } from '@renderer/components/fx/Ticker'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { useChatDrawer } from '@renderer/store/chatDrawer'
import { useGraphBuildRun } from '@renderer/store/graphBuildRun'
import { useNewsRun } from '@renderer/store/newsRun'
import { useTrendingRun } from '@renderer/store/trendingRun'
import { type Section, useUiStore } from '@renderer/store/ui'
import { type CSSProperties, useMemo } from 'react'
import { toast } from 'sonner'

// ms → compact human duration for the avg-duration tile.
function fmtDuration(ms: number): string {
  if (ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

// First couple of meaningful lines of a digest, with frontmatter + leading
// markdown heading marks stripped, for the signal-card preview.
function digestSnippet(raw: string): string {
  const noFm = raw.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const lines = noFm
    .split('\n')
    .map((l) =>
      l
        .replace(/^#{1,6}\s*/, '')
        .replace(/^[*->\s]+/, '')
        .trim(),
    )
    .filter((l) => l.length > 0)
  return lines.slice(0, 2).join(' — ').slice(0, 160)
}

// ── TELEMETRY MARQUEE ──────────────────────────────────────────────────────
// A thin, endlessly scrolling strip of live readouts (all real data; the
// queries are the same ones the panels below use, so nothing extra is fetched).
function TelemetryMarquee() {
  const health = trpc.health.ping.useQuery()
  const today = trpc.productivity.today.useQuery({})
  const kpi = trpc.productivity.kpi.useQuery({ days: 30 })
  const settings = trpc.settings.get.useQuery()
  const t = today.data?.totals
  const items = [
    `TOKENS.TODAY ${t ? num(t.totalTokens) : '—'}`,
    `TURNS ${t ? num(t.turns) : '—'}`,
    `EFF ${pct(kpi.data?.overall)}`,
    `MODEL ${settings.data?.model.replace(/^claude-/, '') ?? '—'}`,
    `MEM ${health.data?.memMB ?? '—'}M`,
    `VER v${health.data?.version ?? '—'}`,
    `STATUS ${health.data?.ok ? 'NOMINAL' : 'DEGRADED'}`,
  ]
  const track = items.map((s) => `▪ ${s}`).join('  ')
  return (
    <div className="fx-marquee" aria-hidden>
      <div className="fx-marquee-track">
        <span>{track}</span>
        <span>{track}</span>
      </div>
    </div>
  )
}

// ── STATUS ROW ─────────────────────────────────────────────────────────────
// Four headline tiles. Each is a single value; Productivity/Stats own the
// behavior behind it. All four read from the today + kpi + summary queries,
// which the panels below reuse (react-query dedupes by key — no double fetch).
function StatusRow() {
  const today = trpc.productivity.today.useQuery({})
  const kpi = trpc.productivity.kpi.useQuery({ days: 30 })
  const summary = trpc.stats.summary.useQuery()

  const t = today.data?.totals
  const byDay = kpi.data?.byDay ?? []
  const sessions30d = byDay.reduce((s, d) => s + d.sessions, 0)
  const tokens30d = byDay.reduce((s, d) => s + d.tokens, 0)
  // Trend direction over the window: last vs first smoothed efficiency point.
  const trend = byDay.length >= 2 ? byDay[byDay.length - 1].kpiSmooth - byDay[0].kpiSmooth : null

  return (
    <div className="kpis bento">
      <div className="kpi hero">
        <div className="label">
          <span className="id">[01]</span>TODAY TOKENS
        </div>
        <div className="val">{t ? <Ticker value={t.totalTokens} /> : '—'}</div>
        <div className="delta">
          {t ? `${num(t.turns)} turns · ${num(t.activeHours)} active hrs` : 'no activity yet'}
        </div>
      </div>

      <div className="kpi wide">
        <div
          className="fx-gauge"
          style={{ '--val': Math.max(0, Math.min(140, kpi.data?.overall ?? 0)) } as CSSProperties}
          aria-hidden
        />
        <div className="label">
          <span className="id">[02]</span>TOKEN EFFICIENCY
        </div>
        <div className="val amber">{pct(kpi.data?.overall)}</div>
        <div className={`delta${trend == null ? '' : trend >= 0 ? ' up' : ' dn'}`}>
          {trend == null
            ? 'vs baseline'
            : `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend).toFixed(0)} pts · 30d`}
        </div>
      </div>

      <div className="kpi">
        <div className="label">
          <span className="id">[03]</span>SESSIONS · 30D
        </div>
        <div className="val">{kpi.data ? <Ticker value={sessions30d} /> : '—'}</div>
        <div className="delta">{kpi.data ? `${compact(tokens30d)} tokens` : 'last 30 days'}</div>
      </div>

      <div className="kpi">
        <div className="label">
          <span className="id">[04]</span>AGENT RUNS
        </div>
        <div className="val">{summary.data ? <Ticker value={summary.data.total} /> : '—'}</div>
        <div className="delta">
          {summary.data ? `avg ${fmtDuration(summary.data.avgDurationMs)}` : 'all time'}
        </div>
      </div>
    </div>
  )
}

// ── ACTIVITY ───────────────────────────────────────────────────────────────
// Stat + sparkline rows: the number carries the meaning, the sparkline shows
// its 30-day shape. All fed by one kpi query. Productivity owns the full
// interactive charts behind the "→".
function StatRow({
  label,
  value,
  sub,
  data,
  dataKey,
  kind,
  color,
}: {
  label: string
  value: string
  sub: string
  data: Array<Record<string, unknown>>
  dataKey: string
  kind: 'line' | 'bar'
  color: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ width: 132, flexShrink: 0 }}>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 11,
            color: 'var(--fg-3)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 22,
            color: 'var(--fg)',
            marginTop: 2,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)' }}>{sub}</div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Sparkline data={data} dataKey={dataKey} kind={kind} color={color} height={48} />
      </div>
    </div>
  )
}

function ActivityPanel() {
  const kpi = trpc.productivity.kpi.useQuery({ days: 30 })
  const byDay = kpi.data?.byDay ?? []
  const tokens30d = byDay.reduce((s, d) => s + d.tokens, 0)
  const sessions30d = byDay.reduce((s, d) => s + d.sessions, 0)
  const perDayTokens = byDay.length ? tokens30d / 30 : 0
  const perDaySessions = byDay.length ? sessions30d / 30 : 0

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="activity · 30d" />
        </span>
        <DrillLink to="productivity" label="productivity" />
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {kpi.isLoading ? (
          <Note>loading…</Note>
        ) : byDay.length === 0 ? (
          <Note>no activity yet — use Claude Code, then refresh on Productivity.</Note>
        ) : (
          <>
            <StatRow
              label="efficiency"
              value={pct(kpi.data?.overall)}
              sub="token eff vs baseline"
              data={byDay}
              dataKey="kpiSmooth"
              kind="line"
              color="var(--color-chart-1)"
            />
            <StatRow
              label="tokens / day"
              value={compact(Math.round(perDayTokens))}
              sub={`${compact(tokens30d)} total`}
              data={byDay}
              dataKey="tokens"
              kind="bar"
              color="var(--color-chart-2)"
            />
            <StatRow
              label="sessions / day"
              value={perDaySessions.toFixed(1)}
              sub={`${num(sessions30d)} total`}
              data={byDay}
              dataKey="sessions"
              kind="bar"
              color="var(--amber)"
            />
          </>
        )}
      </div>
    </div>
  )
}

// ── QUICK ACTIONS ──────────────────────────────────────────────────────────
// One-tap launchers only (the old inline prompt-runner is gone). Long runs use
// App-level run stores / the job registry, so they survive leaving the page.
function QuickActions() {
  const newsRun = useNewsRun()
  const trendingRun = useTrendingRun()
  const buildRun = useGraphBuildRun()
  const compile = trpc.knowledge.compileAll.useMutation({
    onSuccess: (rows) => {
      const ok = rows.filter((r) => r.status === 'compiled').length
      toast.success(
        `Compiled ${ok}/${rows.length} knowledge ${rows.length === 1 ? 'base' : 'bases'}`,
      )
    },
    onError: (e) => toast.error(e.message),
  })
  const benchmark = trpc.benchmark.run.useMutation({
    onSuccess: (r) => toast.success(`Benchmark started — ${r.total} runs queued`),
    onError: (e) => toast.error(e.message),
  })

  // Deep-map target: the project matching the sidebar selection, else the first.
  const projects = trpc.graph.listProjects.useQuery()
  const selectedProject = useUiStore((s) => s.selectedProject)
  const buildPath = useMemo(() => {
    const list = projects.data ?? []
    return (
      list.find((p) => p.project === selectedProject)?.projectPath ?? list[0]?.projectPath ?? null
    )
  }, [projects.data, selectedProject])

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="quick actions" />
        </span>
        <span className="meta">$ atlas run</span>
      </div>
      <div className="panel-body dash-actions">
        <button type="button" className="btn" onClick={newsRun.start} disabled={newsRun.running}>
          ↻ {newsRun.running ? 'NEWS…' : 'AI NEWS'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={trendingRun.start}
          disabled={trendingRun.running}
        >
          ↻ {trendingRun.running ? 'TRENDING…' : 'TRENDING'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => compile.mutate()}
          disabled={compile.isPending}
        >
          ↻ {compile.isPending ? 'COMPILING…' : 'KNOWLEDGE'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => buildPath && buildRun.start(buildPath)}
          disabled={!buildPath || buildRun.running}
        >
          ▶ {buildRun.running ? 'BUILDING…' : 'BUILD MAP'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => benchmark.mutate({})}
          disabled={benchmark.isPending}
        >
          ▶ BENCHMARK
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => useChatDrawer.getState().openSession({ type: 'roadmap' })}
        >
          ◈ ROADMAP IDEA
        </button>
      </div>
    </div>
  )
}

// ── SIGNALS ────────────────────────────────────────────────────────────────
// External digest freshness only — the skills/plugins/system counters are gone.
function SignalCard({
  label,
  to,
  updatedAt,
  raw,
}: {
  label: string
  to: Section
  updatedAt: string | null | undefined
  raw: string | undefined
}) {
  const go = useUiStore((s) => s.setSection)
  const snippet = raw ? digestSnippet(raw) : ''
  return (
    <button
      type="button"
      onClick={() => go(to)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        textAlign: 'left',
        background: 'none',
        border: 'none',
        borderBottom: '1px dashed var(--line-dim)',
        cursor: 'pointer',
        padding: '10px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          fontFamily: 'var(--mono)',
          fontSize: 12,
        }}
      >
        <span style={{ color: 'var(--fg-2)' }}>{label}</span>
        <span style={{ color: 'var(--fg-4)' }}>{timeAgo(updatedAt)}</span>
      </div>
      <span className="line-clamp-2" style={{ fontSize: 13, color: 'var(--fg-3)' }}>
        {snippet || 'no digest yet'}
      </span>
    </button>
  )
}

function SignalsPanel() {
  const news = trpc.news.read.useQuery()
  const trending = trpc.trending.read.useQuery()
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="signals" />
        </span>
        <DrillLink to="news" label="news" />
      </div>
      <div className="panel-body">
        <SignalCard
          label="AI NEWS"
          to="news"
          updatedAt={news.data?.updatedAt}
          raw={news.data?.raw}
        />
        <SignalCard
          label="GITHUB TRENDING"
          to="news"
          updatedAt={trending.data?.updatedAt}
          raw={trending.data?.raw}
        />
      </div>
    </div>
  )
}

export function Dashboard() {
  return (
    <>
      <PageHeader
        num="01"
        title="DASHBOARD"
        description="Mission overview — the whole system at a glance."
      />
      <TelemetryMarquee />
      <div className="scroll">
        <div className="dash-reveal" style={{ '--i': 0 } as CSSProperties}>
          <StatusRow />
        </div>

        <div className="dash-reveal mt-16" style={{ '--i': 1 } as CSSProperties}>
          <QuickActions />
        </div>

        {/* Hero band: galaxy square · narrow NEXT UP · vertical widget rail —
            all three columns stretch to the galaxy's height for one clean line. */}
        <div className="dash-hero-row mt-16">
          <div className="dash-reveal" style={{ '--i': 2 } as CSSProperties}>
            <GalaxyHero />
          </div>
          <div className="dash-reveal" style={{ '--i': 3 } as CSSProperties}>
            <RoadmapNextUp />
          </div>
          <div className="dash-rail">
            <div className="dash-reveal" style={{ '--i': 4 } as CSSProperties}>
              <TokenHeatmap />
            </div>
            <div className="dash-reveal" style={{ '--i': 5 } as CSSProperties}>
              <KnowledgePulse />
            </div>
            <div className="dash-reveal" style={{ '--i': 6 } as CSSProperties}>
              <BenchmarkWidget />
            </div>
          </div>
        </div>

        <div className="dash-mid mt-16">
          <div className="dash-reveal" style={{ '--i': 7 } as CSSProperties}>
            <ActivityPanel />
          </div>
          <div className="dash-reveal" style={{ '--i': 8 } as CSSProperties}>
            <SignalsPanel />
          </div>
        </div>

        <div className="dash-reveal mt-16" style={{ '--i': 9 } as CSSProperties}>
          <ProcessesStrip />
        </div>

        <div className="dash-scan" aria-hidden />
      </div>
    </>
  )
}
