import { NAV } from '@renderer/components/layout/nav'
import { trpc } from '@renderer/lib/trpc'
import { useUiStore } from '@renderer/store/ui'

// Compact token count: 1_340_000 → "1.34M", 17_500 → "17.5K".
function fmtCompact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.?0+$/, '')}K`
  return String(n)
}

export function Sidebar() {
  const section = useUiStore((s) => s.section)
  const setSection = useUiStore((s) => s.setSection)

  const health = trpc.health.ping.useQuery()
  const settings = trpc.settings.get.useQuery()
  const skills = trpc.skills.list.useQuery()
  const today = trpc.productivity.today.useQuery({})

  const version = health.data?.version ?? '0.1.0'
  const model = settings.data?.model.replace(/^claude-/, '') ?? '—'
  const skillCount = skills.data?.length ?? 0
  const tokensToday = today.data?.totals.totalTokens ?? 0
  const runsToday = today.data?.totals.turns ?? 0
  const online = !health.isError && Boolean(health.data?.ok)

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <div className="brand">
          <h1>ATLAS.OS</h1>
          <span className="ver">v{version}</span>
        </div>
        <div className="sub">AI control panel</div>
      </div>

      <div className="sb-section">main</div>
      <nav className="sb-nav">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            className={section === n.id ? 'active' : ''}
            onClick={() => setSection(n.id)}
          >
            <span className="k">{n.key}</span>
            <span>{n.label}</span>
            <span className="badge" />
          </button>
        ))}
      </nav>

      <div className="sb-section">workspace</div>
      <div style={{ padding: '6px 16px 4px' }}>
        <div className="kv" style={{ gridTemplateColumns: '60px 1fr' }}>
          <div className="k">cwd</div>
          <div className="v" style={{ color: 'var(--amber)' }}>
            atlas-os
          </div>
        </div>
        <div className="kv" style={{ gridTemplateColumns: '60px 1fr' }}>
          <div className="k">model</div>
          <div className="v">{model}</div>
        </div>
        <div className="kv" style={{ gridTemplateColumns: '60px 1fr', borderBottom: 0 }}>
          <div className="k">skills</div>
          <div className="v">{skillCount} loaded</div>
        </div>
      </div>

      <div className="sb-foot">
        <div className="row">
          <span>tokens.today</span>
          <b>{fmtCompact(tokensToday)}</b>
        </div>
        <div className="row">
          <span>turns.today</span>
          <b>{runsToday}</b>
        </div>
        <div className="row">
          <span>auth</span>
          <b style={{ color: online ? 'var(--ok)' : 'var(--warn)' }}>
            {online ? '● ok' : '● down'}
          </b>
        </div>
      </div>
    </aside>
  )
}
