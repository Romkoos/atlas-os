import {
  compact,
  DrillLink,
  Note,
  num,
  pct,
  timeAgo,
} from '@renderer/components/dashboard/dash-utils'
import { ProcessesPanel } from '@renderer/components/dashboard/ProcessesPanel'
import { Sparkline } from '@renderer/components/dashboard/Sparkline'
import { Ticker } from '@renderer/components/fx/Ticker'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { formatDateTime } from '@renderer/lib/utils'
import { useNewsRun } from '@renderer/store/newsRun'
import { useTrendingRun } from '@renderer/store/trendingRun'
import { type Section, useUiStore } from '@renderer/store/ui'
import { CLAUDE_MODELS } from '@shared/models'
import { skipToken } from '@tanstack/react-query'
import { type CSSProperties, useMemo, useState } from 'react'
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
  const track = items.map((s) => `▪ ${s}`).join('  ')
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
        <span className="ttl">activity · 30d</span>
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
// The demoted run-agent (compact prompt → stream) plus one-tap launchers for
// the digest/compile runs that live on their own pages. Refresh runs use the
// App-level run stores so they keep going after leaving the Dashboard.
const DEFAULT_PROMPT = 'Generate an idea for an AI tool in a single sentence.'

function QuickActions() {
  const settings = trpc.settings.get.useQuery()
  const utils = trpc.useUtils()
  const openFile = trpc.agent.openFile.useMutation()

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const model = settings.data?.model ?? CLAUDE_MODELS[0].id

  const newsRun = useNewsRun()
  const trendingRun = useTrendingRun()
  const compile = trpc.knowledge.compileAll.useMutation({
    onSuccess: (rows) => {
      const ok = rows.filter((r) => r.status === 'compiled').length
      toast.success(
        `Compiled ${ok}/${rows.length} knowledge ${rows.length === 1 ? 'base' : 'bases'}`,
      )
    },
    onError: (e) => toast.error(e.message),
  })

  const subInput = useMemo(
    () => (running && requestId ? { requestId, prompt, model } : skipToken),
    [running, requestId, prompt, model],
  )

  trpc.agent.run.useSubscription(subInput, {
    onData: (event) => {
      switch (event.type) {
        case 'token':
          setOutput((prev) => prev + event.text)
          break
        case 'done':
          setRunning(false)
          void utils.stats.invalidate()
          toast.success(`Saved to ${event.filePath}`, {
            duration: 8000,
            action: {
              label: 'Open file',
              onClick: () => openFile.mutate({ path: event.filePath }),
            },
          })
          break
        case 'error':
          setRunning(false)
          toast.error(event.message)
          break
        case 'aborted':
          setRunning(false)
          toast('Run cancelled')
          break
      }
    },
    onError: (error) => {
      setRunning(false)
      toast.error(error.message)
    },
  })

  const start = () => {
    setOutput('')
    setRequestId(crypto.randomUUID())
    setRunning(true)
  }
  // Flipping `running` off switches the subscription to skipToken → unsubscribe
  // → the main-side run is aborted in the observable teardown.
  const cancel = () => setRunning(false)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !running && prompt.trim().length > 0) {
      start()
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">quick actions</span>
        <span className="meta">$ atlas run</span>
      </div>
      <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="label-block">
          <label htmlFor="dash-prompt">quick prompt</label>
          <textarea
            id="dash-prompt"
            className="input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
            rows={3}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn primary"
            onClick={start}
            disabled={running || prompt.trim().length === 0}
          >
            <span className="arrow">▶</span>&nbsp;{running ? 'RUNNING…' : 'RUN'}
          </button>
          {running && (
            <button type="button" className="btn" onClick={cancel}>
              ■ CANCEL
            </button>
          )}
        </div>

        {(running || output) && (
          <div
            style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              lineHeight: 1.6,
              color: 'var(--fg)',
              whiteSpace: 'pre-wrap',
              maxHeight: 140,
              overflowY: 'auto',
              borderTop: '1px solid var(--line-dim)',
              paddingTop: 10,
            }}
          >
            <span style={{ color: 'var(--fg-4)' }}>{'>> '}</span>
            {output}
            {running && <span className="caret" />}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            borderTop: '1px solid var(--line-dim)',
            paddingTop: 12,
          }}
        >
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
        </div>
      </div>
    </div>
  )
}

// ── RECENT ACTIVITY ────────────────────────────────────────────────────────
// The three newest sessions across all projects as a "what did I work on
// lately" feed — project, when, volume, summary. Read-only; the full registry
// and rating/difficulty editing live on Productivity.
function RecentActivity() {
  const go = useUiStore((s) => s.setSection)
  const sessions = trpc.productivity.sessions.useQuery({ days: 30 })
  const rows = (sessions.data ?? []).slice(0, 3)

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">recent activity</span>
        <DrillLink to="productivity" label="all sessions" />
      </div>
      <div className="panel-body">
        {sessions.isLoading ? (
          <Note>loading…</Note>
        ) : rows.length === 0 ? (
          <Note>no sessions yet — use Claude Code, then refresh on Productivity.</Note>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {rows.map((s) => (
              <button
                key={s.sessionId}
                type="button"
                onClick={() => go('productivity')}
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
                  <span style={{ color: 'var(--amber)' }}>{s.project}</span>
                  <span style={{ color: 'var(--fg-4)' }}>{timeAgo(s.endedAt ?? s.startedAt)}</span>
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)' }}>
                  {compact(s.totalTokens)} tokens · {num(s.turnCount)} turns
                </div>
                <span
                  className="line-clamp-2"
                  style={{ fontSize: 13, color: 'var(--fg-3)' }}
                  title={s.summary ?? ''}
                >
                  {s.summary ?? '—'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── SIGNALS + SYSTEM ───────────────────────────────────────────────────────
// External digests (news/trending freshness + preview) and the live state of
// the user's setup (skills/plugins counts + last ecosystem change).
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

function SignalsSystem() {
  const news = trpc.news.read.useQuery()
  const trending = trpc.trending.read.useQuery()
  const skills = trpc.skills.list.useQuery()
  const plugins = trpc.plugins.list.useQuery()
  const ecosystem = trpc.productivity.ecosystem.useQuery({ days: 30 })

  const lastChange = ecosystem.data?.[0]
  const enabledPlugins = (plugins.data ?? []).filter((p) => p.enabled).length

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">signals + system</span>
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

        <div className="kv" style={{ marginTop: 8 }}>
          <div className="k">skills</div>
          <div className="v">{skills.data ? `${num(skills.data.length)} installed` : '—'}</div>
        </div>
        <div className="kv">
          <div className="k">plugins</div>
          <div className="v">
            {plugins.data
              ? `${num(plugins.data.length)} installed · ${num(enabledPlugins)} on`
              : '—'}
          </div>
        </div>
        <div className="kv">
          <div className="k">last change</div>
          <div className="v" title={lastChange?.target ?? lastChange?.note ?? ''}>
            {lastChange
              ? `${lastChange.type.replace(/_/g, ' ')} · ${formatDateTime(lastChange.ts)}`
              : 'no changes in 30d'}
          </div>
        </div>
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
        description="System overview at a glance — efficiency, activity, signals, and quick actions."
      />
      <TelemetryMarquee />
      <div className="scroll">
        <StatusRow />

        <div className="mt-16" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
          <ActivityPanel />
          <QuickActions />
        </div>

        <ProcessesPanel />

        <div className="grid-2 mt-16">
          <RecentActivity />
          <SignalsSystem />
        </div>
      </div>
    </>
  )
}
