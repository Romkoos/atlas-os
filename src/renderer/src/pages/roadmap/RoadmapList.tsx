import {
  CATEGORY_LABELS,
  ROADMAP_CATEGORIES,
  type RoadmapItem,
  type RoadmapPriority,
  type RoadmapStatus,
} from '@shared/roadmap'
import { Copy, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'

// Segmented status switch — order + display labels + state-color class.
const SEGMENTS: { status: RoadmapStatus; label: string; cls: string }[] = [
  { status: 'todo', label: 'To do', cls: 'st-todo' },
  { status: 'planned', label: 'Plan', cls: 'st-planned' },
  { status: 'in-progress', label: 'Active', cls: 'st-active' },
  { status: 'done', label: 'Done', cls: 'st-done' },
]

const PRIO_CLASS: Record<RoadmapPriority, string> = {
  high: 'p-high',
  medium: 'p-med',
  low: 'p-low',
}
const PRIO_SHORT: Record<RoadmapPriority, string> = { high: 'High', medium: 'Med', low: 'Low' }

// ── Status segmented switch ──────────────────────────────────────────────────
function StatusSwitch({
  value,
  onChange,
}: {
  value: RoadmapStatus
  onChange: (s: RoadmapStatus) => void
}) {
  return (
    <div className="rm-seg">
      {SEGMENTS.map((s) => (
        <button
          key={s.status}
          type="button"
          className={`${s.cls}${value === s.status ? ' on' : ''}`}
          aria-pressed={value === s.status}
          onClick={() => value !== s.status && onChange(s.status)}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}

// ── Item row ─────────────────────────────────────────────────────────────────
function ItemRow({
  item,
  index,
  onEdit,
  onStatus,
  onDelete,
  onCopy,
}: {
  item: RoadmapItem
  index: number
  onEdit: () => void
  onStatus: (status: RoadmapStatus) => void
  onDelete: () => void
  onCopy: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const idx = String(index).padStart(2, '0')

  return (
    <div className={`rm-row ${PRIO_CLASS[item.priority]}`}>
      <span className="rm-idx">{idx}</span>
      <div className="rm-main">
        <span className="rm-title">{item.title}</span>
        {item.description ? <span className="rm-desc">{item.description}</span> : null}
      </div>
      <div className="rm-side">
        <span className={`rm-prio ${PRIO_CLASS[item.priority]}`}>{PRIO_SHORT[item.priority]}</span>
        <StatusSwitch value={item.status} onChange={onStatus} />
        {confirming ? (
          <span className="rm-confirm">
            delete?
            <button
              type="button"
              className="rm-icon danger"
              onClick={onDelete}
              aria-label="Confirm delete"
            >
              <Trash2 size={14} />
            </button>
            <button
              type="button"
              className="rm-icon"
              onClick={() => setConfirming(false)}
              aria-label="Cancel delete"
            >
              ✕
            </button>
          </span>
        ) : (
          <div className="rm-actions">
            {item.claudePrompt ? (
              <button
                type="button"
                className="rm-icon"
                onClick={onCopy}
                aria-label="Copy Claude Code prompt"
                title="Copy Claude Code prompt"
              >
                <Copy size={14} />
              </button>
            ) : null}
            <button type="button" className="rm-icon" onClick={onEdit} aria-label="Edit item">
              <Pencil size={14} />
            </button>
            <button
              type="button"
              className="rm-icon danger"
              onClick={() => setConfirming(true)}
              aria-label="Delete item"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── List ─────────────────────────────────────────────────────────────────────
interface RoadmapListProps {
  items: RoadmapItem[]
  onEdit: (item: RoadmapItem) => void
  onStatus: (id: string, status: RoadmapStatus) => void
  onDelete: (id: string) => void
  onCopy: (text: string) => void
}

export function RoadmapList({ items, onEdit, onStatus, onDelete, onCopy }: RoadmapListProps) {
  const byCategory = ROADMAP_CATEGORIES.map((cat) => ({
    cat,
    items: items.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0)

  const count = (s: RoadmapStatus) => items.filter((i) => i.status === s).length

  // Global running index across category-ordered items — the "manifest" feel.
  let running = 0

  return (
    <>
      <div className="kpis k5" style={{ marginBottom: 20 }}>
        <div className="kpi">
          <div className="label">
            <span className="id">Σ</span>total
          </div>
          <div className="val">{items.length}</div>
        </div>
        <div className="kpi">
          <div className="label">to do</div>
          <div className="val">{count('todo')}</div>
        </div>
        <div className="kpi">
          <div className="label">planned</div>
          <div className="val">{count('planned')}</div>
        </div>
        <div className="kpi">
          <div className="label">in progress</div>
          <div className="val amber">{count('in-progress')}</div>
        </div>
        <div className="kpi">
          <div className="label">done</div>
          <div className="val" style={{ color: 'var(--ok)' }}>
            {count('done')}
          </div>
        </div>
      </div>

      <div className="rm-stack">
        {byCategory.map(({ cat, items: catItems }) => (
          <section key={cat} className="panel">
            <div className="panel-head">
              <span className="ttl">{CATEGORY_LABELS[cat]}</span>
              <span className="meta">
                {catItems.length} item{catItems.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="rm-rows">
              {catItems.map((item) => {
                running += 1
                return (
                  <ItemRow
                    key={item.id}
                    item={item}
                    index={running}
                    onEdit={() => onEdit(item)}
                    onStatus={(status) => onStatus(item.id, status)}
                    onDelete={() => onDelete(item.id)}
                    onCopy={() => onCopy(item.claudePrompt)}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  )
}
