import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Card, CardContent } from '@renderer/components/ui/card'

export function Stats() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Stats" description="Usage over time." />
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Charts land here.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
