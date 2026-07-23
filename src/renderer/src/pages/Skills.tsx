import { LetterGlitch } from '@renderer/components/fx/LetterGlitch'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { goToChat } from '@renderer/store/chats'
import { useSkillImproverExtra, useSkillImproverRun } from '@renderer/store/skillImproverRun'
import { groupByPrefix, type SkillMeta, splitFrontmatter } from '@shared/skills'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'

function titleCase(tag: string): string {
  return tag.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// Many skills wrap sections in pseudo-XML tags (<objective> … </objective>).
// react-markdown renders those as raw tags; convert each standalone opening tag
// into a heading and drop the closing tag so the body reads as clean markdown.
function formatSkillMarkdown(md: string): string {
  return md
    .replace(/^[ \t]*<\/[a-zA-Z][\w-]*>[ \t]*$/gm, '')
    .replace(
      /^[ \t]*<([a-zA-Z][\w-]*)(?:\s[^>]*)?>[ \t]*$/gm,
      (_match, tag: string) => `\n### ${titleCase(tag)}\n`,
    )
}

const hintStyle = {
  padding: '20px 14px',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  color: 'var(--fg-4)',
} as const

function SkillItem({
  skill,
  selected,
  onSelect,
}: {
  skill: SkillMeta
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button type="button" className={`skill-item${selected ? ' on' : ''}`} onClick={onSelect}>
      <span className="nm">{skill.name}</span>
      {skill.description ? (
        <span className="desc">
          {skill.description.slice(0, 88)}
          {skill.description.length > 88 ? '…' : ''}
        </span>
      ) : null}
      {skill.trigger ? <span className="tag">{skill.trigger}</span> : null}
    </button>
  )
}

// Pull allowed-tools from raw frontmatter for the live preview chips. Supports
// both the inline list ("Read, Write") and the YAML block list (- Read).
function parseToolsFromFrontmatter(frontmatter: string): string[] {
  const lines = frontmatter.split(/\r?\n/)
  const idx = lines.findIndex((l) => /^allowed-tools\s*:/.test(l))
  if (idx === -1) return []
  const inline = lines[idx].replace(/^allowed-tools\s*:/, '').trim()
  if (inline) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean)
  }
  const tools: string[] = []
  for (let i = idx + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*-\s*(.+?)\s*$/)
    if (!m) break
    tools.push(m[1].replace(/^["']|["']$/g, ''))
  }
  return tools
}

function SkillEditorPane({ skillId }: { skillId: string }) {
  const utils = trpc.useUtils()
  const raw = trpc.skills.getRaw.useQuery({ id: skillId })
  const save = trpc.skills.save.useMutation()
  const startImproverBlank = useSkillImproverRun((s) => s.startBlank)
  const improverRunning = useSkillImproverRun((s) => s.running)
  const improverSkillId = useSkillImproverExtra((s) => s.skillId)

  function startImprove() {
    if (improverRunning) {
      toast.error('An improvement is already running')
      return
    }
    useSkillImproverExtra.getState().setSkill(skillId)
    startImproverBlank()
    goToChat({
      type: 'skillImprover',
      title: `improver · ${skillId}`,
    })
  }

  const [buffer, setBuffer] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [editorOpen, setEditorOpen] = useState(true)
  const [previewOpen, setPreviewOpen] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load the buffer whenever the fetched content changes. The caller keys this
  // component by skillId, so selecting another skill remounts and resets state.
  useEffect(() => {
    if (raw.data) {
      setBuffer(raw.data.content)
      setSavedContent(raw.data.content)
    }
  }, [raw.data])

  // Auto-grow the textarea so the OUTER container owns the single shared scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally re-run when buffer or editorOpen changes so the textarea resizes
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [buffer, editorOpen])

  const dirty = buffer !== savedContent
  const improverBusy = improverRunning && improverSkillId === skillId

  function doSave() {
    if (improverBusy) return
    if (!dirty || save.isPending) return
    save.mutate(
      { id: skillId, content: buffer },
      {
        onSuccess: () => {
          setSavedContent(buffer)
          void utils.skills.list.invalidate()
          void utils.skills.get.invalidate({ id: skillId })
          toast.success('Skill saved')
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  // Cmd/Ctrl+S saves. Scoped to the editor region so it does not fight global keys.
  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      doSave()
    }
  }

  const { frontmatter, body } = splitFrontmatter(buffer)
  const tools = parseToolsFromFrontmatter(frontmatter)

  const splitClass = !previewOpen ? 'editor-only' : !editorOpen ? 'preview-only' : ''

  return (
    <div className="split-pane">
      <div className="skill-split-head">
        {editorOpen ? (
          <div className="col-head editor-head">
            <button
              type="button"
              className="col-head"
              style={{ padding: 0 }}
              onClick={() => setEditorOpen(false)}
            >
              <ChevronDown style={{ width: 10, height: 10 }} />
              editor · SKILL.md {dirty ? <span className="dirty-dot">●</span> : null}
            </button>
            <span className="head-actions">
              <button
                type="button"
                className="btn"
                disabled={!dirty || save.isPending || improverBusy}
                onClick={doSave}
              >
                Save ⌘S
              </button>
              <button type="button" className="btn" disabled={improverBusy} onClick={startImprove}>
                <Sparkles style={{ width: 11, height: 11 }} /> Improve
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="col-head editor-head"
            onClick={() => setEditorOpen(true)}
          >
            <ChevronRight style={{ width: 10, height: 10 }} /> editor
          </button>
        )}
        <button
          type="button"
          className="col-head preview-head"
          onClick={() => setPreviewOpen((v) => !v)}
        >
          {previewOpen ? (
            <ChevronDown style={{ width: 10, height: 10 }} />
          ) : (
            <ChevronRight style={{ width: 10, height: 10 }} />
          )}
          preview · rendered
        </button>
      </div>

      <div className={`skill-split ${splitClass}`}>
        {editorOpen ? (
          <div className="editor-col">
            {raw.isLoading ? (
              <div style={{ ...hintStyle, padding: '16px 18px' }}>{'// loading…'}</div>
            ) : (
              <textarea
                ref={textareaRef}
                className="skill-editor"
                spellCheck={false}
                value={buffer}
                onChange={(e) => setBuffer(e.target.value)}
                onKeyDown={onKeyDown}
                readOnly={improverBusy}
              />
            )}
          </div>
        ) : null}
        {previewOpen ? (
          <div className="preview-col">
            {tools.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                  padding: '16px 24px 0',
                }}
              >
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-4)' }}>
                  Tools:
                </span>
                {tools.map((tool) => (
                  <span
                    key={tool}
                    style={{
                      fontFamily: 'var(--mono)',
                      fontSize: 10,
                      color: 'var(--amber)',
                      border: '1px solid var(--amber-dim)',
                      padding: '1px 6px',
                    }}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="md-prose">
              <Markdown remarkPlugins={[remarkGfm]}>{formatSkillMarkdown(body)}</Markdown>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// The editor is always shown for the selected skill; the improver session now
// lives in the CHATS page. The editor auto-refreshes after accept/reject
// because SkillImproverHost invalidates skills.getRaw on done/aborted.
function SelectedRight({ selectedId }: { selectedId: string }) {
  return <SkillEditorPane key={selectedId} skillId={selectedId} />
}

export function Skills() {
  const skills = trpc.skills.list.useQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  const allItems = skills.data ?? []
  const items = filter
    ? allItems.filter(
        (s) =>
          s.id.toLowerCase().includes(filter.toLowerCase()) ||
          s.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : allItems

  return (
    <>
      <PageHeader
        num="08"
        title="SKILLS"
        action={
          <input
            className="input"
            style={{ width: 200 }}
            placeholder="/ filter skills…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        }
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: '300px 1fr',
        }}
      >
        {/* LEFT: skill list */}
        <div
          style={{ overflow: 'auto', paddingBottom: 60, borderRight: '1px solid var(--line-dim)' }}
        >
          {skills.isLoading ? (
            <div style={hintStyle}>{'// loading…'}</div>
          ) : skills.isError ? (
            <div style={{ ...hintStyle, color: 'var(--amber)' }}>{'// error loading skills'}</div>
          ) : items.length === 0 ? (
            <div style={hintStyle}>{'// no skills found in ~/.claude-private/skills'}</div>
          ) : (
            groupByPrefix(items).map(([prefix, group]) =>
              group.length === 1 ? (
                <SkillItem
                  key={prefix}
                  skill={group[0]}
                  selected={selectedId === group[0].id}
                  onSelect={() => setSelectedId(group[0].id)}
                />
              ) : (
                <details key={prefix} className="group">
                  <summary
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 14px',
                      fontFamily: 'var(--mono)',
                      fontSize: 11,
                      color: 'var(--fg-4)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      cursor: 'pointer',
                      listStyle: 'none',
                      borderBottom: '1px solid var(--line-dim)',
                      userSelect: 'none',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ChevronRight style={{ width: 10, height: 10 }} />
                      {prefix}
                    </span>
                    <span>{group.length}</span>
                  </summary>
                  {group.map((skill) => (
                    <SkillItem
                      key={skill.id}
                      skill={skill}
                      selected={selectedId === skill.id}
                      onSelect={() => setSelectedId(skill.id)}
                    />
                  ))}
                </details>
              ),
            )
          )}
        </div>

        {/* RIGHT: editor + live preview */}
        {selectedId ? (
          <SelectedRight selectedId={selectedId} />
        ) : (
          <div className="split-pane">
            <div className="pane-head">
              <span className="ttl">editor · preview</span>
              <span className="meta">no selection</span>
            </div>
            <div className="pane-body" style={{ position: 'relative' }}>
              <LetterGlitch />
              <div style={{ ...hintStyle, padding: '20px 24px', position: 'relative' }}>
                {'// select a skill to edit its SKILL.md'}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
