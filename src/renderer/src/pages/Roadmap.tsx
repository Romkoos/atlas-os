import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { useChatDrawer } from '@renderer/store/chatDrawer'
import {
  CATEGORY_LABELS,
  ROADMAP_CATEGORIES,
  type RoadmapItem,
  type RoadmapPriority,
  type RoadmapStatus,
} from '@shared/roadmap'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { RoadmapDetail } from './roadmap/RoadmapDetail'

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

// ── Page ─────────────────────────────────────────────────────────────────────
export function Roadmap() {
  const utils = trpc.useUtils()
  const list = trpc.roadmap.list.useQuery()
  const [editing, setEditing] = useState<RoadmapItem | null | undefined>(undefined)

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
  const byCategory = ROADMAP_CATEGORIES.map((cat) => ({
    cat,
    items: items.filter((i) => i.category === cat),
  })).filter((g) => g.items.length > 0)

  const count = (s: RoadmapStatus) => items.filter((i) => i.status === s).length

  // Global running index across category-ordered items — the "manifest" feel.
  let running = 0

  return (
    <>
      <PageHeader
        num="02"
        title="ROADMAP"
        description="Candidate features for Atlas OS. Track, prioritize, and evolve the build manifest."
        action={
          <button
            type="button"
            className="btn primary"
            onClick={() => useChatDrawer.getState().openSession({ type: 'roadmap' })}
          >
            <Plus size={12} /> new idea
          </button>
        }
      />

      <div className="scroll">
        {items.length > 0 ? (
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
        ) : null}

        {list.isLoading ? (
          <div className="rm-empty">{'// loading…'}</div>
        ) : items.length === 0 ? (
          <div className="rm-empty">{'// no roadmap items yet — hit “new idea” to add one'}</div>
        ) : (
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
                        onEdit={() => setEditing(item)}
                        onStatus={(status) => update.mutate({ id: item.id, status })}
                        onDelete={() => remove.mutate({ id: item.id })}
                        onCopy={() => copyText.mutate({ text: item.claudePrompt })}
                      />
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
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
