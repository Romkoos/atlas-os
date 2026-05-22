import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@renderer/components/ui/card'
import { Textarea } from '@renderer/components/ui/textarea'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'
import { useUiStore } from '@renderer/store/ui'
import { CLAUDE_MODELS } from '@shared/models'
import { skipToken } from '@tanstack/react-query'
import { LoaderCircle, Play, Square } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

const DEFAULT_PROMPT = 'Сгенерируй идею для AI-инструмента в одно предложение.'

function HealthBadge() {
  const health = trpc.health.ping.useQuery()
  const label = health.isLoading
    ? 'Connecting…'
    : health.isError
      ? 'Backend offline'
      : `Backend OK · v${health.data?.version}`
  const dot = health.isError
    ? 'bg-destructive'
    : health.data
      ? 'bg-emerald-500'
      : 'bg-muted-foreground'

  return (
    <div className="flex items-center gap-2 text-muted-foreground text-xs">
      <span className={cn('size-2 rounded-full', dot)} />
      {label}
    </div>
  )
}

export function Dashboard() {
  const setSection = useUiStore((s) => s.setSection)
  const settings = trpc.settings.get.useQuery()
  const utils = trpc.useUtils()

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)

  const openFile = trpc.agent.openFile.useMutation()
  const cancelMutation = trpc.agent.cancel.useMutation()

  const model = settings.data?.model ?? CLAUDE_MODELS[0].id
  const apiKeyMissing = settings.isSuccess && !settings.data.apiKey

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
    if (apiKeyMissing) {
      toast.error('Add your Anthropic API key in Settings first')
      return
    }
    setOutput('')
    setRequestId(crypto.randomUUID())
    setRunning(true)
  }

  const cancel = () => {
    if (requestId) cancelMutation.mutate({ requestId })
    setRunning(false)
  }

  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard"
        description="Run AI actions and see the latest result."
        action={<HealthBadge />}
      />

      <div className="flex max-w-3xl flex-col gap-6 p-8">
        {apiKeyMissing ? (
          <div className="flex items-center justify-between rounded-md border border-dashed bg-muted/40 px-4 py-3 text-sm">
            <span className="text-muted-foreground">No Anthropic API key set.</span>
            <Button size="sm" variant="outline" onClick={() => setSection('settings')}>
              Open Settings
            </Button>
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run agent</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={running}
              rows={3}
              placeholder="Prompt for Claude…"
            />
            <div className="flex items-center gap-3">
              {running ? (
                <Button variant="destructive" onClick={cancel}>
                  <Square className="size-4" />
                  Cancel
                </Button>
              ) : (
                <Button onClick={start} disabled={prompt.trim().length === 0}>
                  <Play className="size-4" />
                  Run agent
                </Button>
              )}
              {running ? (
                <span className="flex items-center gap-2 text-muted-foreground text-sm">
                  <LoaderCircle className="size-4 animate-spin" />
                  Streaming from {model}…
                </span>
              ) : (
                <span className="text-muted-foreground text-xs">Model: {model}</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Response</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="min-h-40 whitespace-pre-wrap rounded-md border bg-muted/30 p-4 font-mono text-sm">
              {output || <span className="text-muted-foreground">Output will stream here.</span>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
