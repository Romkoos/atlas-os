import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { formatDateTime } from '@renderer/lib/utils'
import { CLAUDE_MODELS, type ClaudeModelId } from '@shared/models'
import { skipToken } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

const DEFAULT_PROMPT = 'Сгенерируй идею для AI-инструмента в одно предложение.'

function HealthBadge() {
  const health = trpc.health.ping.useQuery()

  if (health.isLoading) {
    return (
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
        <span className="dot" /> connecting…
      </span>
    )
  }

  if (health.isError || !health.data) {
    return (
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warn)' }}>
        <span className="dot warn" /> backend.offline
      </span>
    )
  }

  return (
    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
      <span className="dot ok" /> {'backend.ok · '}
      <span style={{ color: 'var(--amber)' }}>v{health.data.version}</span>
    </span>
  )
}

export function Dashboard() {
  const settings = trpc.settings.get.useQuery()
  const utils = trpc.useUtils()
  const health = trpc.health.ping.useQuery()

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [model, setModel] = useState<ClaudeModelId | undefined>(undefined)
  const [startedAt] = useState(() => formatDateTime(new Date()))

  const openFile = trpc.agent.openFile.useMutation()

  const effectiveModel = model ?? settings.data?.model ?? CLAUDE_MODELS[0].id

  const subInput = useMemo(
    () => (running && requestId ? { requestId, prompt, model: effectiveModel } : skipToken),
    [running, requestId, prompt, effectiveModel],
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

  // Flipping `running` off switches the subscription input to skipToken, which
  // unsubscribes → the main-side run is aborted in the observable teardown.
  const cancel = () => setRunning(false)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      if (!running && prompt.trim().length > 0) {
        start()
      }
    }
  }

  const responseMeta = running ? '● streaming…' : output ? '● complete' : '○ idle'

  const authStatus = health.data ? 'claude.subscription · ok' : health.isError ? 'offline' : '…'

  return (
    <>
      <PageHeader
        num="01"
        title="DASHBOARD"
        description={
          <>Run AI actions and see the latest result. Output streams below in real time.</>
        }
        action={<HealthBadge />}
      />
      <div className="scroll">
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
          {/* RUN AGENT */}
          <div className="panel">
            <div className="panel-head">
              <span className="ttl">run agent</span>
              <span className="meta">$ atlas run</span>
            </div>
            <div
              className="panel-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              <div className="label-block">
                <label htmlFor="dash-prompt">prompt</label>
                <textarea
                  id="dash-prompt"
                  className="input"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={running}
                  rows={4}
                />
              </div>
              <div className="label-block">
                <label htmlFor="dash-model">model</label>
                <select
                  id="dash-model"
                  className="select"
                  value={effectiveModel}
                  onChange={(e) => setModel(e.target.value as ClaudeModelId)}
                  disabled={running}
                  style={{ width: '100%' }}
                >
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn primary"
                  onClick={start}
                  disabled={running || prompt.trim().length === 0}
                >
                  <span className="arrow">▶</span>&nbsp;
                  {running ? 'RUNNING…' : 'RUN AGENT'}
                </button>
                {running && (
                  <button type="button" className="btn" onClick={cancel}>
                    ■ CANCEL
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* SESSION */}
          <div className="panel">
            <div className="panel-head">
              <span className="ttl">session</span>
            </div>
            <div className="panel-body">
              <div className="kv">
                <div className="k">started</div>
                <div className="v">{startedAt}</div>
              </div>
              <div className="kv">
                <div className="k">model</div>
                <div className="v">{effectiveModel}</div>
              </div>
              <div className="kv">
                <div className="k">output</div>
                <div className="v" style={{ color: 'var(--amber)' }}>
                  {settings.data?.outputDir ?? '—'}
                </div>
              </div>
              <div className="kv">
                <div className="k">auth</div>
                <div className="v">{authStatus}</div>
              </div>
              <div className="kv">
                <div className="k">version</div>
                <div className="v">{health.data?.version ? `v${health.data.version}` : '—'}</div>
              </div>
            </div>
          </div>
        </div>

        {/* RESPONSE */}
        <div className="panel mt-16">
          <div className="panel-head">
            <span className="ttl">response</span>
            <span className="meta">{responseMeta}</span>
          </div>
          <div className="panel-body" style={{ minHeight: 180 }}>
            {output ? (
              <div
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: 13,
                  lineHeight: 1.65,
                  color: 'var(--fg)',
                  whiteSpace: 'pre-wrap',
                }}
              >
                <span style={{ color: 'var(--fg-4)' }}>{'>> '}</span>
                {output}
                {running && <span className="caret" />}
              </div>
            ) : (
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-4)' }}>
                <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
                output will stream here. press RUN AGENT or ⌘+ENTER.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
