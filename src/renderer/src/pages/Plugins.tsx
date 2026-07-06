import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { useUiStore } from '@renderer/store/ui'
import {
  formatVersion,
  type MarketplacePlugin,
  type McpHealth,
  type McpHealthStatus,
  type Plugin,
  type UpdateInfo,
} from '@shared/plugins'
import { ChevronDown, Download, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

const hintStyle = {
  padding: '20px 14px',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  color: 'var(--fg-4)',
} as const

const TABS = [
  { id: 'installed', label: 'installed' },
  { id: 'marketplace', label: 'marketplace' },
  { id: 'health', label: 'health' },
] as const
type Tab = (typeof TABS)[number]['id']

// ============================ Installed tab ================================

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
  onUninstall,
}: {
  plugin: Plugin
  update: UpdateInfo | undefined
  busy: boolean
  onToggle: () => void
  onUpdate: () => void
  onUninstall: () => void
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

      <button
        type="button"
        className="icon-btn danger"
        disabled={busy}
        onClick={onUninstall}
        title="Uninstall plugin"
      >
        <Trash2 style={{ width: 12, height: 12 }} />
      </button>
    </div>
  )
}

function InstalledTab() {
  const utils = trpc.useUtils()
  const plugins = trpc.plugins.list.useQuery()
  const [updates, setUpdates] = useState<Record<string, UpdateInfo>>({})
  const [updating, setUpdating] = useState<Set<string>>(new Set())
  const [removing, setRemoving] = useState<Set<string>>(new Set())

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
  const uninstall = trpc.plugins.uninstall.useMutation()

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

  async function runUninstall(id: string): Promise<void> {
    if (!window.confirm(`Uninstall ${id}? It will be removed on Claude Code's next launch.`)) return
    setRemoving((s) => new Set(s).add(id))
    try {
      const r = await uninstall.mutateAsync({ id })
      if (r.ok) toast.success(`uninstalled ${id}`)
      else toast.error(r.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'uninstall failed')
    } finally {
      setRemoving((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      utils.plugins.list.invalidate()
      utils.plugins.browse.invalidate()
    }
  }

  const items = plugins.data ?? []
  const pending = items.filter((p) => updates[p.id]?.updateAvailable)
  const busy = check.isPending || updating.size > 0 || removing.size > 0

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
      <div className="mkt-toolbar">
        <span className="mkt-count">{items.length} installed · applies on next launch</span>
        <div style={{ flex: 1 }} />
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
            busy={updating.has(p.id) || removing.has(p.id) || setEnabled.isPending}
            onToggle={() => setEnabled.mutate({ id: p.id, enabled: !p.enabled })}
            onUpdate={() => runUpdate(p.id)}
            onUninstall={() => runUninstall(p.id)}
          />
        ))
      )}
    </>
  )
}

// =========================== Marketplace tab ==============================

function MarketplaceCard({
  plugin,
  installing,
  onInstall,
}: {
  plugin: MarketplacePlugin
  installing: boolean
  onInstall: () => void
}) {
  const [open, setOpen] = useState(false)
  const details = trpc.plugins.details.useQuery({ id: plugin.id }, { enabled: open })

  return (
    <div className="mkt-card">
      <div className="head">
        <button
          type="button"
          className="mkt-expand"
          onClick={() => setOpen((v) => !v)}
          title="Show component inventory"
        >
          <ChevronDown
            style={{ width: 12, height: 12, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
          />
        </button>
        <div className="meta">
          <span className="nm">{plugin.name}</span>
          <span className="sub">
            {plugin.marketplace}
            {plugin.version ? ` · ${formatVersion(plugin.version, null)}` : ''}
          </span>
          {plugin.description ? <span className="desc">{plugin.description}</span> : null}
        </div>
        {plugin.installed ? (
          <span className="installed-badge">installed</span>
        ) : (
          <button type="button" className="btn primary" disabled={installing} onClick={onInstall}>
            <Download style={{ width: 11, height: 11 }} />
            {installing ? 'installing…' : 'install'}
          </button>
        )}
      </div>
      {open ? (
        <pre className="mkt-details">
          {details.isLoading
            ? '// loading details…'
            : details.isError
              ? `// ${details.error.message}`
              : details.data?.output}
        </pre>
      ) : null}
    </div>
  )
}

function MarketplaceTab() {
  const utils = trpc.useUtils()
  const browse = trpc.plugins.browse.useQuery()
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [installing, setInstalling] = useState<Set<string>>(new Set())

  const add = trpc.plugins.addMarketplace.useMutation()
  const install = trpc.plugins.install.useMutation()

  async function runAdd() {
    const src = source.trim()
    if (!src) return
    const r = await add.mutateAsync({ source: src }).catch((err) => ({
      ok: false,
      message: err instanceof Error ? err.message : 'marketplace add failed',
    }))
    if (r.ok) {
      toast.success(`added ${src}`)
      setSource('')
      utils.plugins.browse.invalidate()
    } else {
      toast.error(r.message)
    }
  }

  async function runInstall(id: string) {
    setInstalling((s) => new Set(s).add(id))
    try {
      const r = await install.mutateAsync({ id })
      if (r.ok) toast.success(`installed ${id}`)
      else toast.error(r.message)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'install failed')
    } finally {
      setInstalling((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      utils.plugins.browse.invalidate()
      utils.plugins.list.invalidate()
    }
  }

  const items = browse.data ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) =>
      `${p.name} ${p.description} ${p.marketplace}`.toLowerCase().includes(q),
    )
  }, [items, query])

  return (
    <>
      <div className="mkt-toolbar">
        <input
          className="mkt-input"
          placeholder="search plugins…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div style={{ flex: 1 }} />
        <input
          className="mkt-input"
          placeholder="add marketplace (url / github repo / path)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runAdd()}
          style={{ minWidth: 260 }}
        />
        <button
          type="button"
          className="btn"
          disabled={add.isPending || !source.trim()}
          onClick={runAdd}
          title="Add a plugin marketplace"
        >
          <Plus style={{ width: 11, height: 11 }} />
          {add.isPending ? 'adding…' : 'add'}
        </button>
      </div>

      {browse.isLoading ? (
        <div style={hintStyle}>{'// loading catalog…'}</div>
      ) : browse.isError ? (
        <div style={{ ...hintStyle, color: 'var(--amber)' }}>{`// ${browse.error.message}`}</div>
      ) : items.length === 0 ? (
        <div style={hintStyle}>{'// no marketplaces configured — add one above'}</div>
      ) : filtered.length === 0 ? (
        <div style={hintStyle}>{`// no plugins match "${query}"`}</div>
      ) : (
        filtered.map((p) => (
          <MarketplaceCard
            key={p.id}
            plugin={p}
            installing={installing.has(p.id)}
            onInstall={() => runInstall(p.id)}
          />
        ))
      )}
    </>
  )
}

// ============================== Health tab ================================

const STATUS_COLOR: Record<McpHealthStatus, string> = {
  ok: 'var(--ok)',
  auth: 'var(--amber)',
  error: 'var(--warn)',
  pending: 'var(--fg-4)',
  unknown: 'var(--fg-4)',
}

function HealthRow({ server }: { server: McpHealth }) {
  return (
    <div className="health-row">
      <span className="health-status" style={{ color: STATUS_COLOR[server.status] }}>
        <span className="dot" style={{ background: STATUS_COLOR[server.status] }} />
        {server.status}
      </span>
      <div className="meta">
        <span className="nm">{server.name}</span>
        <span className="sub">
          {server.transport ? `${server.transport} · ` : ''}
          {server.target}
        </span>
      </div>
      <span className="health-detail" title={server.detail}>
        {server.detail}
      </span>
    </div>
  )
}

function HealthTab() {
  const [servers, setServers] = useState<McpHealth[] | null>(null)
  const ping = trpc.plugins.mcpHealth.useMutation({
    onSuccess: (rows) => setServers(rows),
    onError: (err) => toast.error(err.message),
  })
  const run = ping.mutate

  // Run one health check when the tab first mounts.
  useEffect(() => {
    run()
  }, [run])

  const counts = useMemo(() => {
    const c = { ok: 0, auth: 0, error: 0, pending: 0, unknown: 0 }
    for (const s of servers ?? []) c[s.status]++
    return c
  }, [servers])

  return (
    <>
      <div className="mkt-toolbar">
        <span className="mkt-count">
          {servers
            ? `${servers.length} servers · ${counts.ok} ok · ${counts.auth} auth · ${counts.error} error`
            : 'not checked yet'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          type="button"
          className="btn"
          disabled={ping.isPending}
          onClick={() => run()}
          title="Ping every configured MCP server"
        >
          <RefreshCw
            style={{ width: 11, height: 11 }}
            className={ping.isPending ? 'spin' : undefined}
          />
          {ping.isPending ? 'checking…' : 're-check'}
        </button>
      </div>

      {ping.isPending && !servers ? (
        <div style={hintStyle}>{'// pinging MCP servers…'}</div>
      ) : servers && servers.length === 0 ? (
        <div style={hintStyle}>{'// no MCP servers configured'}</div>
      ) : servers ? (
        servers.map((s) => <HealthRow key={s.name} server={s} />)
      ) : (
        <div style={hintStyle}>{'// press re-check to ping MCP servers'}</div>
      )}
    </>
  )
}

// =============================== Page shell ===============================

export function Plugins() {
  const storedTab = useUiStore((s) => s.tabsBySection.plugins)
  const setTab = useUiStore((s) => s.setTab)
  const tab: Tab = TABS.some((t) => t.id === storedTab) ? (storedTab as Tab) : 'installed'

  return (
    <>
      <PageHeader num="09" title="PLUGINS" />

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab('plugins', t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingBottom: 60 }}>
        {tab === 'installed' && <InstalledTab />}
        {tab === 'marketplace' && <MarketplaceTab />}
        {tab === 'health' && <HealthTab />}
      </div>
    </>
  )
}
