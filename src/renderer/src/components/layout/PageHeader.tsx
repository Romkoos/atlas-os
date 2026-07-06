import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import type { ReactNode } from 'react'

export function PageHeader({
  num,
  title,
  action,
}: {
  /** Two-digit screen id shown in amber before the title, e.g. "01". */
  num: string
  title: string
  action?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <h2>
          <span className="num">{num}</span>
          <ScrambleText text={title} />
        </h2>
      </div>
      {action ? <div className="right">{action}</div> : null}
    </div>
  )
}
