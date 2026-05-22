import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Card, CardContent } from '@renderer/components/ui/card'

export function Settings() {
  return (
    <div className="flex flex-col">
      <PageHeader title="Settings" description="API key, model, output folder, theme, logging." />
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Settings form lands here.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
