import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Card, CardContent } from '@renderer/components/ui/card'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'

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
  return (
    <div className="flex flex-col">
      <PageHeader
        title="Dashboard"
        description="Run AI actions and see the latest result."
        action={<HealthBadge />}
      />
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Vertical slice (Run agent) lands here.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
