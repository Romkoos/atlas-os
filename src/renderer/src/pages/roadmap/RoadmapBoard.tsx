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
import { type KeyboardEvent, type ReactNode, useState } from 'react'
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

// Presentational markup shared by the draggable board card and its
// DragOverlay clone. The overlay clone is purely visual — it must not
// register its own `useDraggable`, or dnd-kit logs a duplicate-id warning
// while the live card is being dragged.
function CardBody({
  item,
  onClick,
  onCopy,
  className,
  cardRef,
  dragProps,
  onKeyDown,
}: {
  item: RoadmapItem
  onClick?: () => void
  onCopy?: () => void
  className: string
  cardRef?: (node: HTMLElement | null) => void
  dragProps?: Record<string, unknown>
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dnd-kit's attributes spread supplies role/tabIndex at runtime, opaque to static analysis
    <div ref={cardRef} className={className} {...dragProps} onClick={onClick} onKeyDown={onKeyDown}>
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

function Card({
  item,
  onClick,
  onCopy,
}: {
  item: RoadmapItem
  onClick?: () => void
  onCopy?: () => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id })
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' && e.key !== ' ') return
    if (e.key === ' ') e.preventDefault()
    onClick?.()
  }
  return (
    <CardBody
      item={item}
      onClick={onClick}
      onCopy={onCopy}
      className={`rm-card ${PRIO_CLASS[item.priority]}${isDragging ? ' dragging' : ''}`}
      cardRef={setNodeRef}
      dragProps={{ ...attributes, ...listeners }}
      onKeyDown={onKeyDown}
    />
  )
}

// The DragOverlay clone: no ref/attributes/listeners/keyboard handling, and
// no `useDraggable` registration — it's a static snapshot of the card being
// dragged, rendered by dnd-kit in a portal that follows the pointer.
function CardOverlay({ item }: { item: RoadmapItem }) {
  return <CardBody item={item} className={`rm-card ${PRIO_CLASS[item.priority]} overlay`} />
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
        <DragOverlay>{activeItem ? <CardOverlay item={activeItem} /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}
