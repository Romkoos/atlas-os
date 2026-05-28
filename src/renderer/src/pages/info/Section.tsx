import type { ReactNode } from 'react'

// Wrapper with anchor id + heading. The id is what the secondary-nav scrolls to.
export function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: ReactNode
}) {
  return (
    <section id={id} className="info-section">
      <h3 className="info-h">
        <span
          style={{ color: 'var(--color-muted-fg)', marginRight: 8 }}
        >{`§ ${title.split('.')[0]}`}</span>
        {title.split('.').slice(1).join('.').trim()}
      </h3>
      {children}
    </section>
  )
}
