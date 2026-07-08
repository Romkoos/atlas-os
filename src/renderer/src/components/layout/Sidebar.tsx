import { Ticker } from '@renderer/components/fx/Ticker'
import { NAV } from '@renderer/components/layout/nav'
import { springSnappy } from '@renderer/lib/motion'
import { trpc } from '@renderer/lib/trpc'
import { useChats } from '@renderer/store/chats'
import { useSignalsStore } from '@renderer/store/signals'
import { useUiStore } from '@renderer/store/ui'
import gsap from 'gsap'
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin'
import { motion } from 'motion/react'
import type { MouseEvent } from 'react'

gsap.registerPlugin(ScrambleTextPlugin)

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Decrypt the label (the class-less span) on hover — presentation only; the
// DOM text resolves back to the same string, so accessible names are stable.
function scrambleLabel(e: MouseEvent<HTMLButtonElement>) {
  if (reduced) return
  const label = e.currentTarget.querySelector<HTMLElement>('span:not([class])')
  if (!label) return
  gsap.to(label, {
    duration: 0.3,
    ease: 'none',
    scrambleText: { text: label.textContent ?? '', chars: 'upperCase', speed: 1.3 },
  })
}

export function Sidebar() {
  const section = useUiStore((s) => s.section)
  const setSection = useUiStore((s) => s.setSection)
  const unreadSignals = useSignalsStore((s) => s.unreadCount)
  const activeChats = useChats((s) => s.sessions.length)

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
            onMouseEnter={scrambleLabel}
          >
            {section === n.id && (
              <motion.span layoutId="nav-pill" className="nav-pill" transition={springSnappy} />
            )}
            <span className="k">{n.key}</span>
            <span>{n.label}</span>
            {n.id === 'signals' && unreadSignals > 0 ? (
              <span className="nav-badge">{unreadSignals > 99 ? '99+' : unreadSignals}</span>
            ) : n.id === 'chats' && activeChats > 0 ? (
              <span className="nav-badge">{activeChats}</span>
            ) : (
              <span className="badge" />
            )}
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
          <b>
            <Ticker
              value={tokensToday}
              format={{ notation: 'compact', maximumFractionDigits: 2 }}
            />
          </b>
        </div>
        <div className="row">
          <span>turns.today</span>
          <b>
            <Ticker value={runsToday} />
          </b>
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
