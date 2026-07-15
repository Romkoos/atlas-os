import {
  compact,
  DrillLink,
  Note,
  num,
  pct,
  timeAgo,
} from '@renderer/components/dashboard/dash-utils'
import { GalaxyHero } from '@renderer/components/dashboard/GalaxyHero'
import { ProcessesStrip } from '@renderer/components/dashboard/ProcessesStrip'
import { RoadmapNextUp } from '@renderer/components/dashboard/RoadmapNextUp'
import { Sparkline } from '@renderer/components/dashboard/Sparkline'
import { capSignalsForPanel } from '@renderer/components/dashboard/signals-feed'
import { TokenHeatmap } from '@renderer/components/dashboard/TokenHeatmap'
import { UsagePlasmaWidget } from '@renderer/components/dashboard/UsagePlasmaWidget'
import { WeeklyPlasmaWidget } from '@renderer/components/dashboard/WeeklyPlasmaWidget'
import { BorderBeam } from '@renderer/components/fx/BorderBeam'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { Ticker } from '@renderer/components/fx/Ticker'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { SEVERITY_META } from '@renderer/lib/signalStyle'
import { trpc } from '@renderer/lib/trpc'
import { useOpenSignal } from '@renderer/lib/useOpenSignal'
import { useBeamRoam } from '@renderer/store/beamRoam'
import { goToChat } from '@renderer/store/chats'
import { useGraphBuildRun } from '@renderer/store/graphBuildRun'
import { useNewsRun } from '@renderer/store/newsRun'
import { useSignalsStore } from '@renderer/store/signals'
import { useTrendingRun } from '@renderer/store/trendingRun'
import { useUiStore } from '@renderer/store/ui'
import type { SignalView } from '@shared/signals'
import { type CSSProperties, useEffect, useMemo } from 'react'

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

      {/* ── Right stack: heatmap ─────────────────────────────────────────────── */}
      <div className="kpis-hero-side">
        <TokenHeatmap />
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
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {kpi.isLoading ? (
          <Note>loading…</Note>
        ) : byDay.length === 0 ? (
          <Note>no activity yet — use Claude Code, then refresh.</Note>
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
          onClick={() => buildPath && buildRun.start(buildPath)}
          disabled={!buildPath || buildRun.running}
        >
          ▶ {buildRun.running ? 'BUILDING…' : 'BUILD MAP'}
        </button>
        <button type="button" className="btn" onClick={() => goToChat({ type: 'roadmap' })}>
          ◈ ROADMAP IDEA
        </button>
      </div>
    </div>
  )
}

// ── SIGNALS ────────────────────────────────────────────────────────────────
// Live cross-subsystem event feed (jobs, infra, roadmap, chat). Reads
// the signals store fed by the app-wide SignalsHost subscription — no fetch here.
function SignalFeedRow({ sig, onOpen }: { sig: SignalView; onOpen: (s: SignalView) => void }) {
  const { icon: Icon, color } = SEVERITY_META[sig.severity]
  const unread = sig.readAt === null
  return (
    <button
      type="button"
      className={`sig-feed-row${unread ? ' unread' : ''}`}
      onClick={() => onOpen(sig)}
    >
      <span className="sig-feed-ico" style={{ color }}>
        <Icon size={14} />
      </span>
      <span className="sig-feed-title">{sig.title}</span>
      <span className="sig-feed-time">{timeAgo(sig.createdAt)}</span>
    </button>
  )
}

function SignalsPanel() {
  const signals = useSignalsStore((s) => s.signals)
  const beam = useBeamRoam((s) => s.active === 'signals')
  const open = useOpenSignal()
  const top = capSignalsForPanel(signals)
  return (
    <div className="panel">
      {beam && <BorderBeam duration={5} />}
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="signals" />
        </span>
        <DrillLink to="signals" label="view all" />
      </div>
      <div className="panel-body">
        {top.length === 0 ? (
          <Note>no signals yet</Note>
        ) : (
          top.map((sig) => <SignalFeedRow key={sig.id} sig={sig} onOpen={open} />)
        )}
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
      <PageHeader num="01" title="DASHBOARD" />
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
