import { timeAgo } from '@renderer/components/dashboard/dash-utils'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { SEVERITY_META } from '@renderer/lib/signalStyle'
import { trpc } from '@renderer/lib/trpc'
import { useOpenSignal } from '@renderer/lib/useOpenSignal'
import { useSignalsStore } from '@renderer/store/signals'
import {
  SIGNAL_SEVERITIES,
  SIGNAL_SOURCES,
  type SignalSeverity,
  type SignalView,
} from '@shared/signals'
import { Search } from 'lucide-react'
import { useState } from 'react'

// A single filter chip row (source or severity). value=null → the "all" chip.
function Chips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[]
  value: T | null
  onChange: (v: T | null) => void
}) {
  return (
    <div className="sig-chips">
      <button
        type="button"
        className={`sig-chip${value === null ? ' on' : ''}`}
        onClick={() => onChange(null)}
      >
        all
      </button>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`sig-chip${value === opt ? ' on' : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

function SignalItem({ sig, onOpen }: { sig: SignalView; onOpen: (s: SignalView) => void }) {
  const { icon: Icon, color } = SEVERITY_META[sig.severity]
  const unread = sig.readAt === null
  return (
    <button
      type="button"
      className={`sig-row${unread ? ' unread' : ''}`}
      onClick={() => onOpen(sig)}
    >
      <span className="sig-ico" style={{ color }}>
        <Icon size={15} />
      </span>
      <span className="sig-main">
        <span className="sig-title-row">
          <span className="sig-title">{sig.title}</span>
          <span className="sig-time">{timeAgo(sig.createdAt)}</span>
        </span>
        <span className="sig-meta">
          <span className="sig-tag">{sig.source}</span>
          <span className="sig-type">{sig.type}</span>
          {sig.detail && <span className="sig-detail">— {sig.detail}</span>}
        </span>
      </span>
      {unread && <span className="sig-dot" style={{ background: color }} />}
    </button>
  )
}

export function Signals() {
  const [source, setSource] = useState<string | null>(null)
  const [severity, setSeverity] = useState<SignalSeverity | null>(null)
  const [search, setSearch] = useState('')

  const utils = trpc.useUtils()
  const history = trpc.signals.history.useQuery({
    source: source ?? undefined,
    severity: severity ?? undefined,
    search: search.trim() || undefined,
    limit: 300,
  })
  const unreadCount = useSignalsStore((s) => s.unreadCount)
  const markAll = trpc.signals.markAllRead.useMutation({
    onSuccess: () => utils.signals.history.invalidate(),
  })
  const open = useOpenSignal()

  const rows = history.data?.rows ?? []

  return (
    <>
      <PageHeader
        num="07"
        title="SIGNALS"
        action={
          <button
            type="button"
            className="btn"
            disabled={unreadCount === 0 || markAll.isPending}
            onClick={() => markAll.mutate()}
          >
            {unreadCount > 0 ? `mark all read (${unreadCount})` : 'all read'}
          </button>
        }
      />

      <div className="sig-page">
        <div className="sig-filters">
          <Chips options={SIGNAL_SOURCES} value={source} onChange={setSource} />
          <Chips options={SIGNAL_SEVERITIES} value={severity} onChange={setSeverity} />
          <div className="sig-search">
            <Search size={13} />
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search signals…"
            />
          </div>
        </div>

        <div className="scroll">
          {history.isLoading ? (
            <div className="sig-empty">{'// loading…'}</div>
          ) : rows.length === 0 ? (
            <div className="sig-empty">
              {'// no signals match — subsystems log events here as they happen'}
            </div>
          ) : (
            <div className="sig-list">
              {rows.map((sig) => (
                <SignalItem key={sig.id} sig={sig} onOpen={open} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
