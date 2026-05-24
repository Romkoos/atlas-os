import type { ReactNode } from 'react'

export function PageHeader({
  num,
  title,
  description,
  action,
}: {
  /** Two-digit screen id shown in amber before the title, e.g. "01". */
  num: string
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="page-head">
      <div>
        <h2>
          <span className="num">{num}</span>
          {title}
        </h2>
        {description ? <div className="desc">{description}</div> : null}
      </div>
      {action ? <div className="right">{action}</div> : null}
    </div>
  )
}
