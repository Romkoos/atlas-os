import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Formula } from '@renderer/pages/info/Formula'

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
          <Formula
            display
            tex="\\text{Eff} = \\frac{\\text{expected}}{\\text{actual}} \\times 100\\%"
          />
        </div>
      </div>
    </div>
  )
}
