import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Baseline } from '@renderer/pages/info/sections/baseline'
import { Daily } from '@renderer/pages/info/sections/daily'
import { DataSources } from '@renderer/pages/info/sections/data-sources'
import { Intro } from '@renderer/pages/info/sections/intro'
import { PerSession } from '@renderer/pages/info/sections/per-session'
import { Storage } from '@renderer/pages/info/sections/storage'

interface NavAnchor {
  id: string
  label: string
}

const ANCHORS: NavAnchor[] = [
  { id: 'intro', label: '1. Зачем эта метрика' },
  { id: 'data-sources', label: '2. Источники данных' },
  { id: 'storage', label: '3. Что мы храним' },
  { id: 'baseline', label: '4. Бейзлайн' },
  { id: 'per-session', label: '5. Per-session Eff' },
  { id: 'daily', label: '6. Дневной Eff' },
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
          <Storage />
          <Baseline />
          <PerSession />
          <Daily />
        </div>
      </div>
    </div>
  )
}
