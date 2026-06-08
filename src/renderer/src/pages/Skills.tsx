import { ImproverReportView } from '@renderer/components/ImproverReportView'
import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { useSkillImproverRun } from '@renderer/store/skillImproverRun'
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
  const startImprover = useSkillImproverRun((s) => s.start)
  const improverRunning = useSkillImproverRun((s) => s.running)

  function startImprove() {
    if (improverRunning) {
      toast.error('An improvement is already running')
      return
    }
    startImprover(skillId)
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

  function doSave() {
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
                disabled={!dirty || save.isPending}
                onClick={doSave}
              >
                Save ⌘S
              </button>
              <button type="button" className="btn" onClick={startImprove}>
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

function ImproverOverlay({ skillId }: { skillId: string }) {
  const run = useSkillImproverRun()
  const reply = trpc.skillImprover.reply.useMutation()
  const accept = trpc.skillImprover.accept.useMutation()
  const reject = trpc.skillImprover.reject.useMutation()
  const cancel = trpc.skillImprover.cancel.useMutation()
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the transcript pinned to the latest output.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin whenever streamed content changes
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [run.transcript, run.streaming, run.report])

  function send() {
    const text = draft.trim()
    if (!text || !run.requestId) return
    run.pushUserReply(text)
    reply.mutate({ requestId: run.requestId, text })
    setDraft('')
  }

  return (
    <div className="split-pane">
      <div className="pane-head">
        <span className="ttl">improver · {skillId}</span>
        <span className="meta">
          {run.status === 'reviewing' ? 'awaiting your decision' : run.status}
        </span>
      </div>
      <div className="improver">
        <div className="improver-transcript" ref={scrollRef}>
          {run.transcript.map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: transcript is append-only
            <div key={i} className={`improver-entry ${e.kind}`}>
              {e.kind === 'tool' ? `⚙ ${e.text}` : e.text}
            </div>
          ))}
          {run.streaming ? <div className="improver-entry">{run.streaming}</div> : null}
          {run.report ? (
            <div style={{ marginTop: 16 }}>
              <ImproverReportView report={run.report} />
            </div>
          ) : null}
        </div>

        {run.status === 'reviewing' ? (
          <div className="improver-foot">
            <button
              type="button"
              className="btn"
              disabled={accept.isPending || reject.isPending || !run.requestId}
              onClick={() => run.requestId && accept.mutate({ requestId: run.requestId })}
            >
              Accept
            </button>
            <button
              type="button"
              className="btn"
              disabled={accept.isPending || reject.isPending || !run.requestId}
              onClick={() => run.requestId && reject.mutate({ requestId: run.requestId })}
            >
              Reject
            </button>
          </div>
        ) : run.running ? (
          <div className="improver-foot">
            <input
              className="input"
              placeholder={run.awaitingInput ? 'Type your reply…' : 'thinking…'}
              disabled={!run.awaitingInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button type="button" className="btn" disabled={!run.awaitingInput} onClick={send}>
              Send
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => run.requestId && cancel.mutate({ requestId: run.requestId })}
            >
              Stop
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// Chooses between the editor and the improver overlay for the selected skill.
function SelectedRight({ selectedId }: { selectedId: string }) {
  const status = useSkillImproverRun((s) => s.status)
  const runSkillId = useSkillImproverRun((s) => s.skillId)
  const reset = useSkillImproverRun((s) => s.reset)

  const isActive = runSkillId === selectedId && (status === 'running' || status === 'reviewing')
  const isTerminal =
    runSkillId === selectedId && (status === 'done' || status === 'error' || status === 'aborted')

  // Once a session for the selected skill has ended, clear it so the editor
  // returns (showing the now-updated or reverted content). Done in an effect, not
  // during render, to avoid setState-during-render.
  useEffect(() => {
    if (isTerminal) reset()
  }, [isTerminal, reset])

  if (isActive) return <ImproverOverlay skillId={selectedId} />
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
        num="07"
        title="SKILLS"
        description={
          <>
            Skills in your global <span style={{ color: 'var(--amber)' }}>~/.claude/skills</span>{' '}
            folder.{' '}
            {allItems.length > 0 ? (
              <span style={{ color: 'var(--fg-3)' }}>
                {allItems.length} available · auto-loaded on start.
              </span>
            ) : null}
          </>
        }
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
            <div style={hintStyle}>{'// no skills found in ~/.claude/skills'}</div>
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

        {/* RIGHT: editor + live preview, or improver overlay */}
        {selectedId ? (
          <SelectedRight selectedId={selectedId} />
        ) : (
          <div className="split-pane">
            <div className="pane-head">
              <span className="ttl">editor · preview</span>
              <span className="meta">no selection</span>
            </div>
            <div className="pane-body">
              <div style={{ ...hintStyle, padding: '20px 24px' }}>
                {'// select a skill to edit its SKILL.md'}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
