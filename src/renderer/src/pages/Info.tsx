import { PageHeader } from '@renderer/components/layout/PageHeader'

export function Info() {
  return (
    <div className="page">
      <PageHeader
        num="04"
        title="info"
        description="Token Efficiency — методика, данные, формулы"
      />
      <div className="panel mt-16">
        <div className="panel-body">
          <p style={{ color: 'var(--color-muted-fg)' }}>Страница в сборке.</p>
        </div>
      </div>
    </div>
  )
}
