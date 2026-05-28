import { PageHeader } from '@renderer/components/layout/PageHeader'
import { DataSources } from '@renderer/pages/info/sections/data-sources'
import { Intro } from '@renderer/pages/info/sections/intro'

interface NavAnchor {
  id: string
  label: string
}

const ANCHORS: NavAnchor[] = [
  { id: 'intro', label: '1. Зачем эта метрика' },
  { id: 'data-sources', label: '2. Источники данных' },
  // remaining anchors appended in later tasks
]

export function Info() {
  return (
    <div className="page info-page">
      <PageHeader
        num="04"
        title="info"
        description="Token Efficiency — методика, данные, формулы"
      />
      <div className="info-grid">
        <nav className="info-nav">
          <ul>
            {ANCHORS.map((a) => (
              <li key={a.id}>
                <a href={`#${a.id}`}>{a.label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="info-content">
          <Intro />
          <DataSources />
        </div>
      </div>
    </div>
  )
}
