import { PageHeader } from '@renderer/components/layout/PageHeader'
import { RoadmapChatOverlay } from '@renderer/components/RoadmapChatOverlay'
import { TermSelect } from '@renderer/components/ui/select'
import { trpc } from '@renderer/lib/trpc'
import { useRoadmapChatRun } from '@renderer/store/roadmapChatRun'
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  ROADMAP_CATEGORIES,
  ROADMAP_PRIORITIES,
  ROADMAP_STATUSES,
  type RoadmapCategory,
  type RoadmapItem,
  type RoadmapPriority,
  type RoadmapStatus,
  STATUS_LABELS,
} from '@shared/roadmap'
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

// Segmented status switch — order + display labels + state-color class.
const SEGMENTS: { status: RoadmapStatus; label: string; cls: string }[] = [
  { status: 'idea', label: 'Idea', cls: 'st-idea' },
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

const statusOptions = ROADMAP_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))
const priorityOptions = ROADMAP_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))
const categoryOptions = ROADMAP_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))

interface Draft {
  title: string
  description: string
  category: RoadmapCategory
  status: RoadmapStatus
  priority: RoadmapPriority
  claudePrompt: string
}

const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  category: 'intelligence',
  status: 'idea',
  priority: 'medium',
  claudePrompt: '',
}

// ── Editor modal ─────────────────────────────────────────────────────────────
// `item` null = create, item = edit, undefined = closed.
function RoadmapEditor({
  item,
  onClose,
  onSaved,
}: {
  item: RoadmapItem | null | undefined
  onClose: () => void
  onSaved: () => void
}) {
  const open = item !== undefined
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)

  useEffect(() => {
    if (item === undefined) return
    setDraft(
      item
        ? {
            title: item.title,
            description: item.description,
            category: item.category,
            status: item.status,
            priority: item.priority,
            claudePrompt: item.claudePrompt,
          }
        : EMPTY_DRAFT,
    )
  }, [item])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const create = trpc.roadmap.create.useMutation()
  const update = trpc.roadmap.update.useMutation()
  const saving = create.isPending || update.isPending

  if (!open) return null

  async function save() {
    if (!draft.title.trim()) {
      toast.error('Title is required')
      return
    }
    try {
      if (item) {
        await update.mutateAsync({ id: item.id, ...draft })
        toast.success('Item updated')
      } else {
        await create.mutateAsync(draft)
        toast.success('Item added')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <div className="rm-backdrop">
      <button
        type="button"
        className="rm-backdrop-btn"
        aria-label="Close editor"
        onClick={onClose}
      />
      <div
        className="panel rm-modal"
        role="dialog"
        aria-modal="true"
        aria-label={item ? 'Edit roadmap item' : 'New roadmap item'}
      >
        <div className="rm-modal-head">
          <span className="tag">{item ? 'edit item' : 'new item'}</span>
          <span>{item ? CATEGORY_LABELS[draft.category] : 'roadmap'}</span>
        </div>

        <div className="rm-modal-body">
          <div className="rm-field">
            <label className="rm-field-label" htmlFor="rm-title">
              Title<span className="req">*</span>
            </label>
            <input
              id="rm-title"
              className="input"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder="Feature name"
              // biome-ignore lint/a11y/noAutofocus: focus the first field when the editor opens
              autoFocus
            />
          </div>

          <div className="rm-field">
            <label className="rm-field-label" htmlFor="rm-desc">
              Description
            </label>
            <textarea
              id="rm-desc"
              className="input"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="What it does and why it fits Atlas OS"
              rows={4}
            />
          </div>

          <div className="rm-grid3">
            <div className="rm-field">
              <span className="rm-field-label">Category</span>
              <TermSelect
                value={draft.category}
                onValueChange={(v) => setDraft((d) => ({ ...d, category: v as RoadmapCategory }))}
                options={categoryOptions}
              />
            </div>
            <div className="rm-field">
              <span className="rm-field-label">Status</span>
              <TermSelect
                value={draft.status}
                onValueChange={(v) => setDraft((d) => ({ ...d, status: v as RoadmapStatus }))}
                options={statusOptions}
              />
            </div>
            <div className="rm-field">
              <span className="rm-field-label">Priority</span>
              <TermSelect
                value={draft.priority}
                onValueChange={(v) => setDraft((d) => ({ ...d, priority: v as RoadmapPriority }))}
                options={priorityOptions}
              />
            </div>
          </div>

          <div className="rm-field">
            <label className="rm-field-label" htmlFor="rm-claude">
              Claude Code prompt
            </label>
            <textarea
              id="rm-claude"
              className="input"
              value={draft.claudePrompt}
              onChange={(e) => setDraft((d) => ({ ...d, claudePrompt: e.target.value }))}
              placeholder="Short English brief for Claude Code: what to build and where it lives"
              rows={4}
            />
          </div>
        </div>

        <div className="rm-modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            cancel
          </button>
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'saving…' : item ? 'save changes' : 'add item'}
          </button>
        </div>
      </div>
    </div>
  )
}

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
  const [chatOpen, setChatOpen] = useState(false)
  const chatStatus = useRoadmapChatRun((s) => s.status)

  // Re-open the incubator when returning to the page mid-session (the session
  // itself lives at App level and keeps running while the tab is away).
  useEffect(() => {
    if (chatStatus !== 'idle') setChatOpen(true)
  }, [chatStatus])

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
          <button type="button" className="btn primary" onClick={() => setChatOpen(true)}>
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
              <div className="label">idea</div>
              <div className="val">{count('idea')}</div>
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

      <RoadmapEditor
        item={editing}
        onClose={() => setEditing(undefined)}
        onSaved={() => utils.roadmap.list.invalidate()}
      />

      {chatOpen ? <RoadmapChatOverlay onClose={() => setChatOpen(false)} /> : null}
    </>
  )
}
