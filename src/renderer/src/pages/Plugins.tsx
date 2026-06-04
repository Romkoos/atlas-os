import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { formatVersion, type Plugin, type UpdateInfo } from '@shared/plugins'
import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

const hintStyle = {
  padding: '20px 14px',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  color: 'var(--fg-4)',
} as const

function Toggle({
  enabled,
  disabled,
  onToggle,
}: {
  enabled: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`plugin-toggle${enabled ? ' on' : ''}`}
      disabled={disabled}
      onClick={onToggle}
      title={enabled ? 'Disable plugin' : 'Enable plugin'}
    >
      <span className="dot" />
      {enabled ? 'enabled' : 'disabled'}
    </button>
  )
}

function PluginRow({
  plugin,
  update,
  busy,
  onToggle,
  onUpdate,
}: {
  plugin: Plugin
  update: UpdateInfo | undefined
  busy: boolean
  onToggle: () => void
  onUpdate: () => void
}) {
  const hasUpdate = update?.updateAvailable === true
  return (
    <div className="plugin-row">
      <div className="meta">
        <span className="nm">{plugin.name}</span>
        <span className="sub">
          {plugin.marketplace} · {formatVersion(plugin.version, plugin.commit)}
        </span>
      </div>

      {hasUpdate ? (
        <span className="upd-badge" title="A newer version is available">
          update → {update?.latestVersion ?? 'new'}
        </span>
      ) : null}

      {hasUpdate ? (
        <button type="button" className="btn primary" disabled={busy} onClick={onUpdate}>
          {busy ? 'updating…' : 'update'}
        </button>
      ) : null}

      <Toggle enabled={plugin.enabled} disabled={busy} onToggle={onToggle} />
    </div>
  )
}

export function Plugins() {
  const utils = trpc.useUtils()
  const plugins = trpc.plugins.list.useQuery()
  const [updates, setUpdates] = useState<Record<string, UpdateInfo>>({})
  const [updating, setUpdating] = useState<Set<string>>(new Set())

  const setEnabled = trpc.plugins.setEnabled.useMutation({
    onMutate: async ({ id, enabled }) => {
      await utils.plugins.list.cancel()
      const prev = utils.plugins.list.getData()
      utils.plugins.list.setData(undefined, (old) =>
        old?.map((p) => (p.id === id ? { ...p, enabled } : p)),
      )
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) utils.plugins.list.setData(undefined, ctx.prev)
      toast.error(err.message)
    },
    onSettled: () => utils.plugins.list.invalidate(),
  })

  const check = trpc.plugins.checkUpdates.useMutation({
    onSuccess: (rows) => {
      setUpdates(Object.fromEntries(rows.map((r) => [r.id, r])))
      const n = rows.filter((r) => r.updateAvailable).length
      toast(n > 0 ? `${n} update${n > 1 ? 's' : ''} available` : 'all plugins up to date')
    },
    onError: (err) => toast.error(err.message),
  })

  const update = trpc.plugins.update.useMutation()

  async function runUpdate(id: string): Promise<boolean> {
    setUpdating((s) => new Set(s).add(id))
    try {
      const r = await update.mutateAsync({ id })
      if (r.ok) {
        toast.success(`updated ${id}`)
        setUpdates((u) => {
          const next = { ...u }
          delete next[id]
          return next
        })
      } else {
        toast.error(r.message)
      }
      return r.ok
    } finally {
      setUpdating((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      utils.plugins.list.invalidate()
    }
  }

  const items = plugins.data ?? []
  const pending = items.filter((p) => updates[p.id]?.updateAvailable)
  const busy = check.isPending || updating.size > 0

  async function updateAll() {
    let ok = 0
    for (const p of pending) {
      // eslint-disable-next-line no-await-in-loop -- sequential by design
      if (await runUpdate(p.id)) ok++
    }
    toast(`updated ${ok}/${pending.length}`)
  }

  return (
    <>
      <PageHeader
        num="07"
        title="plugins"
        description={
          <>
            Your global Claude Code plugins.{' '}
            <span style={{ color: 'var(--fg-3)' }}>
              {items.length} installed · changes apply on Claude Code's next launch.
            </span>
          </>
        }
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {pending.length > 0 ? (
              <button type="button" className="btn primary" disabled={busy} onClick={updateAll}>
                update all ({pending.length})
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => check.mutate()}
              title="Refresh marketplaces and check for plugin updates (network)"
            >
              <RefreshCw
                style={{ width: 11, height: 11 }}
                className={check.isPending ? 'spin' : undefined}
              />
              {check.isPending ? 'checking…' : 'check for updates'}
            </button>
          </div>
        }
      />

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {plugins.isLoading ? (
          <div style={hintStyle}>{'// loading…'}</div>
        ) : plugins.isError ? (
          <div style={{ ...hintStyle, color: 'var(--amber)' }}>{`// ${plugins.error.message}`}</div>
        ) : items.length === 0 ? (
          <div style={hintStyle}>{'// no user-scoped plugins installed'}</div>
        ) : (
          items.map((p) => (
            <PluginRow
              key={p.id}
              plugin={p}
              update={updates[p.id]}
              busy={updating.has(p.id) || setEnabled.isPending}
              onToggle={() => setEnabled.mutate({ id: p.id, enabled: !p.enabled })}
              onUpdate={() => runUpdate(p.id)}
            />
          ))
        )}
      </div>
    </>
  )
}
