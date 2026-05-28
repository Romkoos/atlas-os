import { PageHeader } from '@renderer/components/layout/PageHeader'
import { Baseline } from '@renderer/pages/info/sections/baseline'
import { Caveats } from '@renderer/pages/info/sections/caveats'
import { Daily } from '@renderer/pages/info/sections/daily'
import { DataSources } from '@renderer/pages/info/sections/data-sources'
import { Intro } from '@renderer/pages/info/sections/intro'
import { OutOfScope } from '@renderer/pages/info/sections/out-of-scope'
import { PerSession } from '@renderer/pages/info/sections/per-session'
import { Reliability } from '@renderer/pages/info/sections/reliability'
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
  { id: 'reliability', label: '7. Надёжность' },
  { id: 'out-of-scope', label: '8. Что мы НЕ измеряем' },
  { id: 'caveats', label: '9. Известные ограничения' },
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
          <Reliability />
          <OutOfScope />
          <Caveats />
        </div>
      </div>
    </div>
  )
}
