import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { goToChat } from '@renderer/store/chats'
import { useUiStore } from '@renderer/store/ui'
import { useWorkerChatRun } from '@renderer/store/workerChatRun'
import { useWorkerPrefill } from '@renderer/store/workerPrefill'
import type { RoadmapItem } from '@shared/roadmap'
import { buildDevPlanKickoff } from '@shared/roadmap'
import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
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
  const startingDevRef = useRef(false)

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

  const setBinding = trpc.roadmap.setDevBinding.useMutation({
    onSuccess: () => utils.roadmap.getDevBinding.invalidate(),
  })

  // Rocket: begin the plan → build → deploy lifecycle for one item. Moves the
  // item to `planned`, binds the worker to it, and auto-starts an interactive
  // brainstorm. Refuses if the worker is already bound/busy (non-destructive).
  const BUSY_STATUSES = ['running', 'awaiting', 'reconnecting', 'limited']
  const startDevelopment = async (item: RoadmapItem) => {
    if (!item.claudePrompt) return
    if (startingDevRef.current) return
    startingDevRef.current = true
    try {
      const existing = await utils.roadmap.getDevBinding.fetch()
      const busy = BUSY_STATUSES.includes(useWorkerChatRun.getState().status)
      if (existing || busy) {
        goToChat({ type: 'worker' })
        toast.error('Worker is busy — finish or stop the current development first')
        return
      }
      update.mutate({ id: item.id, status: 'planned' })
      setBinding.mutate({ itemId: item.id, phase: 'planning' })
      useWorkerChatRun.getState().reset()
      useWorkerPrefill.getState().setPrefill({
        prompt: buildDevPlanKickoff(item),
        model: 'claude-opus-4-8',
        autoStart: true,
      })
      goToChat({ type: 'worker' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start development')
    } finally {
      startingDevRef.current = false
    }
  }

  const items = list.data ?? []
  const visibleItems = hideDoneFilter(items, hideDone) // list uses this; board gets full items + hideDone flag

  return (
    <>
      <PageHeader
        num="02"
        title="ROADMAP"
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
              onClick={() => goToChat({ type: 'roadmap' })}
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
            onStartDev={startDevelopment}
          />
        ) : (
          <RoadmapList
            items={visibleItems}
            countItems={items}
            onEdit={(item) => setEditing(item)}
            onStatus={(id, status) => update.mutate({ id, status })}
            onDelete={(id) => remove.mutate({ id })}
            onStartDev={startDevelopment}
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
