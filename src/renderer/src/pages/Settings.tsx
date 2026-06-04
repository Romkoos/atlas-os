import { zodResolver } from '@hookform/resolvers/zod'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { CLAUDE_MODELS } from '@shared/models'
import { type AppSettings, LOG_LEVELS, settingsSchema, THEMES } from '@shared/settings'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

// Render uptimeMs as a compact "4d 12h" / "12h 3m" / "3m" string.
function formatUptime(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

// Pick which projects the Productivity tracker counts. Empty selection = all.
function TrackedProjectsCard() {
  const utils = trpc.useUtils()
  const discover = trpc.productivity.discoverProjects.useQuery()
  const setTracked = trpc.settings.set.useMutation({
    onSuccess: () => {
      void utils.settings.get.invalidate()
      void utils.productivity.invalidate()
    },
    onError: (error) => toast.error(error.message),
  })

  const projects = discover.data ?? []
  const allPaths = projects.map((p) => p.projectPath)
  const tracked = projects.filter((p) => p.tracked).length
  const allTracked = projects.length > 0 && projects.every((p) => p.tracked)

  const toggle = (path: string) => {
    const next = new Set(projects.filter((p) => p.tracked).map((p) => p.projectPath))
    if (next.has(path)) next.delete(path)
    else next.add(path)
    const arr = [...next]
    // [] means "track all" — collapse a full or empty selection to that default.
    const value = arr.length === 0 || arr.length === allPaths.length ? [] : arr
    setTracked.mutate({ trackedProjects: value })
  }

  return (
    <div className="panel mt-16">
      <div className="panel-head">
        <span className="ttl">tracked projects</span>
        <span className="meta">
          {tracked} / {projects.length} tracked · none selected = all tracked
        </span>
      </div>
      <div className="panel-body">
        <div
          style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            color: 'var(--fg-3)',
            marginBottom: 12,
          }}
        >
          Productivity only counts these projects.
        </div>

        {discover.isLoading ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-4)' }}>
            Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-4)' }}>
            No projects yet. Run Refresh on the Productivity page first.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {projects.map((p) => (
                <button
                  key={p.projectPath}
                  type="button"
                  aria-pressed={p.tracked}
                  onClick={() => toggle(p.projectPath)}
                  disabled={setTracked.isPending}
                  title={p.projectPath}
                  className={`chip ${p.tracked ? 'on' : ''}`}
                >
                  {p.project}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="btn"
                disabled={allTracked || setTracked.isPending}
                onClick={() => setTracked.mutate({ trackedProjects: [] })}
              >
                TRACK ALL
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Real runtime status sourced from health.ping (no fake pid/port/launchd).
function RuntimeStatusCard({ model }: { model: string }) {
  const ping = trpc.health.ping.useQuery(undefined, { refetchInterval: 5000 })
  const data = ping.data
  const online = !ping.isError && !!data

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">runtime status</span>
        <span className="meta">health.ping · 5s</span>
      </div>
      <div className="panel-body">
        <div className="kv">
          <div className="k">status</div>
          <div className="v">
            {online ? (
              <>
                <span className="dot ok" /> &nbsp;running
              </>
            ) : (
              <>
                <span className="dot warn" /> &nbsp;offline
              </>
            )}
          </div>
        </div>
        <div className="kv">
          <div className="k">version</div>
          <div className="v">{data ? `v${data.version}` : '—'}</div>
        </div>
        <div className="kv">
          <div className="k">mem</div>
          <div className="v">{data ? `${data.memMB} MB` : '—'}</div>
        </div>
        <div className="kv">
          <div className="k">uptime</div>
          <div className="v">{data ? formatUptime(data.uptimeMs) : '—'}</div>
        </div>
        <div className="kv">
          <div className="k">model</div>
          <div className="v">{model}</div>
        </div>
      </div>
    </div>
  )
}

const HOTKEYS: ReadonlyArray<readonly [label: string, key: string]> = [
  ['run agent', '⌘ + ENTER'],
  ['switch screens', '⌘ + 1..5'],
  ['settings', '⌘ + ,'],
]

export function Settings() {
  const utils = trpc.useUtils()
  const settingsQuery = trpc.settings.get.useQuery()

  const form = useForm<AppSettings>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      model: CLAUDE_MODELS[0].id,
      outputDir: '',
      theme: 'system',
      logLevel: 'info',
      trackedProjects: [],
      estimateDifficulty: false,
    },
  })

  useEffect(() => {
    if (settingsQuery.data) form.reset(settingsQuery.data)
  }, [settingsQuery.data, form])

  const saveMutation = trpc.settings.set.useMutation({
    onSuccess: (data) => {
      form.reset(data)
      void utils.settings.get.invalidate()
      toast.success('Settings saved')
    },
    onError: (error) => toast.error(error.message),
  })

  const resetMutation = trpc.settings.reset.useMutation({
    onSuccess: (data) => {
      form.reset(data)
      void utils.settings.get.invalidate()
      toast.success('Settings reset to defaults')
    },
    onError: (error) => toast.error(error.message),
  })

  const chooseDir = trpc.settings.chooseDirectory.useMutation({
    onSuccess: (result) => {
      if (result.path) {
        form.setValue('outputDir', result.path, { shouldDirty: true, shouldValidate: true })
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const onSubmit = form.handleSubmit((values) => saveMutation.mutate(values))

  const currentModel = form.watch('model')

  return (
    <>
      <PageHeader
        num="05"
        title="SETTINGS"
        description={<>Model, output folder, theme, logging.</>}
      />
      <div className="scroll">
        {/* AUTH banner */}
        <div className="panel" style={{ borderColor: 'var(--amber-dim)', borderStyle: 'solid' }}>
          <div
            style={{
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontFamily: 'var(--mono)',
              fontSize: 13,
              color: 'var(--fg-2)',
            }}
          >
            <span style={{ color: 'var(--amber)', fontSize: 14 }}>◇</span>
            <div>
              Atlas OS uses your <b style={{ color: 'var(--fg)' }}>Claude subscription</b> via
              Claude Code — no API key needed. If a run fails with an auth error, run{' '}
              <code
                style={{ background: 'var(--bg-2)', padding: '1px 6px', color: 'var(--amber)' }}
              >
                claude login
              </code>{' '}
              in a terminal.
            </div>
          </div>
        </div>

        <div className="grid-2 mt-16">
          {/* RUNTIME — form */}
          <div className="panel">
            <div className="panel-head">
              <span className="ttl">runtime</span>
              <span className="meta">config</span>
            </div>
            <div className="panel-body">
              {settingsQuery.isLoading ? (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-4)' }}>
                  Loading settings…
                </div>
              ) : (
                <form
                  onSubmit={onSubmit}
                  style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                >
                  <div className="label-block">
                    <label htmlFor="settings-model">default model</label>
                    <select id="settings-model" className="select" {...form.register('model')}>
                      {CLAUDE_MODELS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="label-block">
                    <label htmlFor="settings-outputDir">output folder</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        id="settings-outputDir"
                        className="input"
                        readOnly
                        placeholder="Choose a folder"
                        style={{ flex: 1 }}
                        {...form.register('outputDir')}
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={() => chooseDir.mutate()}
                        disabled={chooseDir.isPending}
                      >
                        ▢ CHOOSE…
                      </button>
                    </div>
                    {form.formState.errors.outputDir ? (
                      <div
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 11,
                          color: 'var(--warn)',
                        }}
                      >
                        {form.formState.errors.outputDir.message}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 11,
                          color: 'var(--fg-4)',
                        }}
                      >
                        generated <code style={{ color: 'var(--amber)' }}>.md</code> files are saved
                        here.
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    <div className="label-block">
                      <label htmlFor="settings-theme">theme</label>
                      <select id="settings-theme" className="select" {...form.register('theme')}>
                        {THEMES.map((theme) => (
                          <option key={theme} value={theme}>
                            {capitalize(theme)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="label-block">
                      <label htmlFor="settings-logLevel">log level</label>
                      <select
                        id="settings-logLevel"
                        className="select"
                        {...form.register('logLevel')}
                      >
                        {LOG_LEVELS.map((level) => (
                          <option key={level} value={level}>
                            {capitalize(level)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="label-block">
                    <label
                      htmlFor="settings-estimateDifficulty"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                    >
                      <input
                        id="settings-estimateDifficulty"
                        type="checkbox"
                        style={{ accentColor: 'var(--amber)', cursor: 'pointer' }}
                        {...form.register('estimateDifficulty')}
                      />
                      estimate task difficulty with AI (experimental)
                    </label>
                    <div
                      style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        color: 'var(--fg-4)',
                      }}
                    >
                      adds an LLM call at ingest to score each task's difficulty. increases token
                      usage.
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                    <button
                      type="submit"
                      className="btn primary"
                      disabled={saveMutation.isPending || !form.formState.isDirty}
                    >
                      {saveMutation.isPending ? '[ SAVING… ]' : '[ SAVE ]'}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => resetMutation.mutate()}
                      disabled={resetMutation.isPending}
                    >
                      RESET TO DEFAULTS
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* RUNTIME STATUS — real health.ping */}
          <RuntimeStatusCard model={currentModel} />
        </div>

        <TrackedProjectsCard />

        {/* HOTKEYS */}
        <div className="panel mt-16">
          <div className="panel-head">
            <span className="ttl">hotkeys</span>
            <span className="meta">global</span>
          </div>
          <div
            className="panel-body"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px 24px',
              fontFamily: 'var(--mono)',
              fontSize: 12,
            }}
          >
            {HOTKEYS.map(([label, key]) => (
              <div
                key={key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  borderBottom: '1px dashed var(--line-dim)',
                  padding: '6px 0',
                }}
              >
                <span style={{ color: 'var(--fg-4)' }}>{label}</span>
                <span style={{ color: 'var(--amber)' }}>{key}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
