import { TermSelect } from '@renderer/components/ui/select'
import { trpc } from '@renderer/lib/trpc'
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
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

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
  status: 'todo',
  priority: 'medium',
  claudePrompt: '',
}

// ── Detail panel ─────────────────────────────────────────────────────────────
// `item` null = create, item = edit, undefined = closed.
export function RoadmapDetail({
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

        <div className="rm-modal-body rm-detail-grid">
          <div className="rm-detail-main">
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
          {item ? (
            <div className="rm-detail-side">
              <div className="rm-detail-section">
                <span className="rm-field-label">Comments</span>
                <div className="rm-placeholder">{'// comes with the Atlas agent'}</div>
              </div>
              <div className="rm-detail-section">
                <span className="rm-field-label">Activity</span>
                <div className="rm-placeholder">{'// comes with the Atlas agent'}</div>
              </div>
            </div>
          ) : null}
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
