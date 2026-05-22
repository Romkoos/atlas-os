import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b px-8 py-6">
      <div>
        <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-muted-foreground text-sm">{description}</p> : null}
      </div>
      {action}
    </header>
  )
}
