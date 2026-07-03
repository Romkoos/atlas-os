import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { useChatDrawer } from '@renderer/store/chatDrawer'
import { useUiStore } from '@renderer/store/ui'
import type { RoadmapItem } from '@shared/roadmap'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { hideDoneFilter } from './roadmap/board-utils'
import { RoadmapBoard } from './roadmap/RoadmapBoard'
import { RoadmapDetail } from './roadmap/RoadmapDetail'
import { RoadmapList } from './roadmap/RoadmapList'

// ── Page ─────────────────────────────────────────────────────────────────────
export function Roadmap() {
  const utils = trpc.useUtils()
  const list = trpc.roadmap.list.useQuery()
  const [editing, setEditing] = useState<RoadmapItem | null | undefined>(undefined)

  const view = useUiStore((s) => s.tabsBySection.roadmap) ?? 'list'
  const setTab = useUiStore((s) => s.setTab)
  const hideDone = useUiStore((s) => s.roadmapHideDone)
  const setHideDone = useUiStore((s) => s.setRoadmapHideDone)

  const update = trpc.roadmap.update.useMutation({
    onMutate: async (vars) => {
      await utils.roadmap.list.cancel()
      const prev = utils.roadmap.list.getData()
      utils.roadmap.list.setData(undefined, (old) =>
        old?.map((i) => (i.id === vars.id ? { ...i, ...vars } : i)),
      )
      return { prev }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) utils.roadmap.list.setData(undefined, ctx.prev)
      toast.error(err.message)
    },
    onSettled: () => utils.roadmap.list.invalidate(),
  })

  const remove = trpc.roadmap.remove.useMutation({
    onSuccess: () => {
      toast.success('Item deleted')
      utils.roadmap.list.invalidate()
    },
    onError: (err) => toast.error(err.message),
  })

  const copyText = trpc.roadmap.copyText.useMutation({
    onSuccess: () => toast.success('Claude Code prompt copied'),
    onError: (err) => toast.error(err.message),
  })

  const items = list.data ?? []
  const visibleItems = hideDoneFilter(items, hideDone) // list uses this; board gets full items + hideDone flag

  return (
    <>
      <PageHeader
        num="02"
        title="ROADMAP"
        description="Candidate features for Atlas OS. Track, prioritize, and evolve the build manifest."
        action={
          <div className="rm-head-actions">
            <div className="tabs rm-view-tabs">
              <button
                type="button"
                className={view === 'list' ? 'on' : ''}
                onClick={() => setTab('roadmap', 'list')}
              >
                List
              </button>
              <button
                type="button"
                className={view === 'board' ? 'on' : ''}
                onClick={() => setTab('roadmap', 'board')}
              >
                Board
              </button>
            </div>
            <button
              type="button"
              className={`btn${hideDone ? ' primary' : ''}`}
              onClick={() => setHideDone(!hideDone)}
              aria-pressed={hideDone}
            >
              {hideDone ? 'show done' : 'hide done'}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => useChatDrawer.getState().openSession({ type: 'roadmap' })}
            >
              <Plus size={12} /> new idea
            </button>
          </div>
        }
      />

      <div className="scroll">
        {list.isLoading ? (
          <div className="rm-empty">{'// loading…'}</div>
        ) : items.length === 0 ? (
          <div className="rm-empty">{'// no roadmap items yet — hit “new idea” to add one'}</div>
        ) : view === 'board' ? (
          <RoadmapBoard
            items={items}
            hideDone={hideDone}
            onCardClick={(item) => setEditing(item)}
            onStatusChange={(id, status) => update.mutate({ id, status })}
            onCopy={(text) => copyText.mutate({ text })}
          />
        ) : (
          <RoadmapList
            items={visibleItems}
            countItems={items}
            onEdit={(item) => setEditing(item)}
            onStatus={(id, status) => update.mutate({ id, status })}
            onDelete={(id) => remove.mutate({ id })}
            onCopy={(text) => copyText.mutate({ text })}
          />
        )}
      </div>

      <RoadmapDetail
        item={editing}
        onClose={() => setEditing(undefined)}
        onSaved={() => utils.roadmap.list.invalidate()}
      />
    </>
  )
}
