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
import { UsagePlasmaWidget } from '@renderer/components/dashboard/UsagePlasmaWidget'
import { WeeklyPlasmaWidget } from '@renderer/components/dashboard/WeeklyPlasmaWidget'
import { BorderBeam } from '@renderer/components/fx/BorderBeam'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { Ticker } from '@renderer/components/fx/Ticker'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { useBeamRoam } from '@renderer/store/beamRoam'
import { useChatDrawer } from '@renderer/store/chatDrawer'
import { useGraphBuildRun } from '@renderer/store/graphBuildRun'
import { useNewsRun } from '@renderer/store/newsRun'
import { useTrendingRun } from '@renderer/store/trendingRun'
import { type Section, useUiStore } from '@renderer/store/ui'
import { type CSSProperties, useEffect, useMemo } from 'react'
import { toast } from 'sonner'

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
// Bento band: left stack (today tokens + sessions) · two plasma rings · right
// stack (heatmap + knowledge tiles). All fed by the today + kpi queries the
// panels below reuse (react-query dedupes by key — no double fetch).
function StatusRow() {
  const today = trpc.productivity.today.useQuery({})
  const kpi = trpc.productivity.kpi.useQuery({ days: 30 })

  const t = today.data?.totals
  const byDay = kpi.data?.byDay ?? []
  const sessions30d = byDay.reduce((s, d) => s + d.sessions, 0)
  const tokens30d = byDay.reduce((s, d) => s + d.tokens, 0)

  return (
    <div className="kpis-hero">
      {/* ── Left stack: TODAY TOKENS + SESSIONS · 30D ──────────────────────── */}
      <div className="kpis-hero-side">
        <div className="kpi">
          <div className="label">
            <span className="id">[01]</span>TODAY TOKENS
          </div>
          <div className="val amber">{t ? <Ticker value={t.totalTokens} /> : '—'}</div>
          <div className="delta">
            {t ? `${num(t.turns)} turns · ${num(t.activeHours)} active hrs` : 'no activity yet'}
          </div>
        </div>

        <div className="kpi">
          <div className="label">
            <span className="id">[02]</span>SESSIONS · 30D
          </div>
          <div className="val">{kpi.data ? <Ticker value={sessions30d} /> : '—'}</div>
          <div className="delta">{kpi.data ? `${compact(tokens30d)} tokens` : 'last 30 days'}</div>
        </div>
      </div>

      {/* ── Center: session (5h) + weekly (7d) plasma rings ─────────────────── */}
      <UsagePlasmaWidget />
      <WeeklyPlasmaWidget />

      {/* ── Right stack: heatmap + knowledge tiles ─────────────────────────── */}
      <div className="kpis-hero-side">
        <TokenHeatmap />
        <KnowledgePulse />
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
  const beam = useBeamRoam((s) => s.active === 'activity')

  return (
    <div className="panel">
      {beam && <BorderBeam duration={5} />}
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
  const beam = useBeamRoam((s) => s.active === 'quick')

  return (
    <div className="panel">
      {beam && <BorderBeam duration={5} />}
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
  const beam = useBeamRoam((s) => s.active === 'signals')
  return (
    <div className="panel">
      {beam && <BorderBeam duration={5} />}
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
  // Roam the border-beam to a new random panel every 5s (each fires one lap).
  const roam = useBeamRoam((s) => s.roam)
  useEffect(() => {
    const id = window.setInterval(roam, 5000)
    return () => window.clearInterval(id)
  }, [roam])

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

        {/* Hero band: galaxy square · NEXT UP · signals — NEXT UP and signals
            share equal width, both stretching to the galaxy's height. */}
        <div className="dash-hero-row mt-16">
          <div className="dash-reveal" style={{ '--i': 2 } as CSSProperties}>
            <GalaxyHero />
          </div>
          <div className="dash-reveal" style={{ '--i': 3 } as CSSProperties}>
            <RoadmapNextUp />
          </div>
          <div className="dash-reveal" style={{ '--i': 4 } as CSSProperties}>
            <SignalsPanel />
          </div>
        </div>

        <div className="dash-mid mt-16">
          <div className="dash-reveal" style={{ '--i': 5 } as CSSProperties}>
            <ActivityPanel />
          </div>
          <div className="dash-reveal" style={{ '--i': 6 } as CSSProperties}>
            <ProcessesStrip />
          </div>
        </div>

        <div className="dash-scan" aria-hidden />
      </div>
    </>
  )
}
