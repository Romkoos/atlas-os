import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Card, CardContent } from '@renderer/components/ui/card'

export function Dashboard() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Dashboard" description="Run AI actions and see the latest result." />
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
