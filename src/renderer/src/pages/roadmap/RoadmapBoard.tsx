import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { TermSelect } from '@renderer/components/ui/select'
import {
  CATEGORY_LABELS,
  ROADMAP_CATEGORIES,
  ROADMAP_STATUSES,
  type RoadmapItem,
  type RoadmapStatus,
  STATUS_LABELS,
} from '@shared/roadmap'
import { Copy } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import {
  CATEGORY_SHORT,
  type CategoryFilter,
  filterByCategory,
  groupByStatus,
  sortColumnItems,
} from './board-utils'

const PRIO_CLASS: Record<RoadmapItem['priority'], string> = {
  high: 'p-high',
  medium: 'p-med',
  low: 'p-low',
}
const PRIO_SHORT: Record<RoadmapItem['priority'], string> = {
  high: 'High',
  medium: 'Med',
  low: 'Low',
}

const categoryFilterOptions = [
  { value: 'all', label: 'All categories' },
  ...ROADMAP_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
]

function Card({
  item,
  onClick,
  onCopy,
  overlay = false,
}: {
  item: RoadmapItem
  onClick?: () => void
  onCopy?: () => void
  overlay?: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id })
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit's attributes spread supplies role/tabIndex at runtime, opaque to static analysis
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activation is the PointerSensor's drag; click-to-open has no keyboard equivalent yet
    <div
      ref={overlay ? undefined : setNodeRef}
      className={`rm-card ${PRIO_CLASS[item.priority]}${isDragging ? ' dragging' : ''}${overlay ? ' overlay' : ''}`}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      onClick={onClick}
    >
      <div className="rm-card-title">{item.title}</div>
      <div className="rm-card-foot">
        <span className="rm-cat-badge">{CATEGORY_SHORT[item.category]}</span>
        <span className={`rm-card-prio ${PRIO_CLASS[item.priority]}`}>
          {PRIO_SHORT[item.priority]}
        </span>
        {item.claudePrompt ? (
          <button
            type="button"
            className="rm-icon rm-card-copy"
            aria-label="Copy Claude Code prompt"
            title="Copy Claude Code prompt"
            // Stop the drag/click-open handlers from also firing.
            onClick={(e) => {
              e.stopPropagation()
              onCopy?.()
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Copy size={13} />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Column({
  status,
  count,
  collapsed,
  children,
}: {
  status: RoadmapStatus
  count: number
  collapsed: boolean
  children: ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={`rm-col${collapsed ? ' collapsed' : ''}${isOver ? ' over' : ''}`}
    >
      <div className="rm-col-head">
        <span className="rm-col-ttl">{STATUS_LABELS[status]}</span>
        <span className="rm-col-count">{count}</span>
      </div>
      {collapsed ? null : <div className="rm-cards">{children}</div>}
    </div>
  )
}

export interface RoadmapBoardProps {
  items: RoadmapItem[]
  hideDone: boolean
  onCardClick: (item: RoadmapItem) => void
  onStatusChange: (id: string, status: RoadmapStatus) => void
  onCopy: (text: string) => void
}

export function RoadmapBoard({
  items,
  hideDone,
  onCardClick,
  onStatusChange,
  onCopy,
}: RoadmapBoardProps) {
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [activeId, setActiveId] = useState<string | null>(null)
  // A small drag threshold lets plain clicks through to onCardClick.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const visible = filterByCategory(items, category)
  const grouped = groupByStatus(visible)
  const activeItem = activeId ? (items.find((i) => i.id === activeId) ?? null) : null

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over) return
    const item = items.find((i) => i.id === active.id)
    const target = over.id as RoadmapStatus
    if (!item || item.status === target) return
    onStatusChange(String(active.id), target)
  }

  return (
    <div className="rm-board-wrap">
      <div className="rm-board-toolbar">
        <TermSelect
          value={category}
          onValueChange={(v) => setCategory(v as CategoryFilter)}
          options={categoryFilterOptions}
        />
      </div>
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="rm-board">
          {ROADMAP_STATUSES.map((status) => {
            const colItems = sortColumnItems(grouped[status])
            const collapsed = status === 'done' && hideDone
            return (
              <Column key={status} status={status} count={colItems.length} collapsed={collapsed}>
                {colItems.map((item) => (
                  <Card
                    key={item.id}
                    item={item}
                    onClick={() => onCardClick(item)}
                    onCopy={() => onCopy(item.claudePrompt)}
                  />
                ))}
              </Column>
            )
          })}
        </div>
        <DragOverlay>{activeItem ? <Card item={activeItem} overlay /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
