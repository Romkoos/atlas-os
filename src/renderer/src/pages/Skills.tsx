import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { groupByPrefix, type SkillMeta } from '@shared/skills'
import { skipToken } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

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
  fontSize: 11,
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

export function Skills() {
  const skills = trpc.skills.list.useQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const detail = trpc.skills.get.useQuery(selectedId ? { id: selectedId } : skipToken)

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
        num="04"
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
        <div style={{ overflow: 'auto', borderRight: '1px solid var(--line-dim)' }}>
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
                      fontSize: 10,
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

        {/* RIGHT: rendered preview */}
        <div className="split-pane">
          <div className="pane-head">
            <span className="ttl">preview · rendered</span>
            <span className="meta">{selectedId ? `${selectedId}.md` : 'no selection'}</span>
          </div>
          <div className="pane-body">
            {!selectedId ? (
              <div style={{ ...hintStyle, padding: '20px 24px' }}>
                {'// select a skill to read its SKILL.md'}
              </div>
            ) : detail.isLoading ? (
              <div style={{ ...hintStyle, padding: '20px 24px' }}>{'// loading…'}</div>
            ) : detail.isError ? (
              <div style={{ ...hintStyle, padding: '20px 24px', color: 'var(--amber)' }}>
                {'// error loading skill content'}
              </div>
            ) : detail.data ? (
              <>
                {detail.data.meta.allowedTools.length > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 6,
                      padding: '16px 24px 0',
                    }}
                  >
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--fg-4)' }}>
                      Tools:
                    </span>
                    {detail.data.meta.allowedTools.map((tool) => (
                      <span
                        key={tool}
                        style={{
                          fontFamily: 'var(--mono)',
                          fontSize: 9,
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
                  <Markdown remarkPlugins={[remarkGfm]}>
                    {formatSkillMarkdown(detail.data.content)}
                  </Markdown>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </>
  )
}
