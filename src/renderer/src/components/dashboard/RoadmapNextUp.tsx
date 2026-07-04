import { Note } from '@renderer/components/dashboard/dash-utils'
import { ScrambleText } from '@renderer/components/fx/ScrambleText'
import { trpc } from '@renderer/lib/trpc'
import { useUiStore } from '@renderer/store/ui'
import type { RoadmapItem } from '@shared/roadmap'
import { useMemo } from 'react'
import { groupNextUp } from './next-up'

// Kanban digest: click anywhere lands on the Roadmap board view.
export function RoadmapNextUp() {
  const go = useUiStore((s) => s.setSection)
  const setTab = useUiStore((s) => s.setTab)
  const items = trpc.roadmap.list.useQuery()
  const groups = useMemo(() => groupNextUp(items.data ?? []), [items.data])

  const openBoard = () => {
    setTab('roadmap', 'board')
    go('roadmap')
  }

  const total = groups.inProgress.length + groups.nextUp.length + groups.done.length

  const Row = ({ item, glyph, cls }: { item: RoadmapItem; glyph: string; cls?: string }) => (
    <button
      type="button"
      className={`nextup-row${cls ? ` ${cls}` : ''}`}
      onClick={openBoard}
      title={item.title}
    >
      <span className="nextup-glyph">{glyph}</span>
      <span className="nextup-title">{item.title}</span>
      {item.priority === 'high' && <span className="nextup-pri">!!</span>}
    </button>
  )

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="ttl">
          <ScrambleText text="next up" />
        </span>
        <button
          type="button"
          className="meta"
          onClick={openBoard}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
            fontFamily: 'var(--mono)',
          }}
        >
          board →
        </button>
      </div>
      <div className="panel-body">
        {items.isLoading ? (
          <Note>loading…</Note>
        ) : total === 0 ? (
          <Note>roadmap is empty — capture an idea.</Note>
        ) : (
          <>
            {groups.inProgress.length > 0 && (
              <>
                <div className="nextup-group">in progress</div>
                {groups.inProgress.map((i) => (
                  <Row key={i.id} item={i} glyph="▸" />
                ))}
              </>
            )}
            {groups.nextUp.length > 0 && (
              <>
                <div className="nextup-group">next up</div>
                {groups.nextUp.map((i) => (
                  <Row key={i.id} item={i} glyph="▹" />
                ))}
              </>
            )}
            {groups.done.length > 0 && (
              <>
                <div className="nextup-group">recently done</div>
                {groups.done.map((i) => (
                  <Row key={i.id} item={i} glyph="✓" cls="done" />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
