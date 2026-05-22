import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { cn } from '@renderer/lib/utils'
import { skipToken } from '@tanstack/react-query'
import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Tailwind descendant styling for rendered SKILL.md (no typography plugin needed).
const PROSE = cn(
  'max-w-3xl text-sm leading-relaxed',
  '[&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:font-semibold [&_h1]:text-xl',
  '[&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:font-semibold [&_h2]:text-lg',
  '[&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:font-medium [&_h3]:text-base',
  '[&_p]:my-3 [&_a]:text-primary [&_a]:underline',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:my-3 [&_table]:w-full [&_table]:text-xs',
  '[&_th]:border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:px-2 [&_td]:py-1',
  '[&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground',
)

function Badge({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'primary' }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px]',
        tone === 'primary' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

export function Skills() {
  const skills = trpc.skills.list.useQuery()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const detail = trpc.skills.get.useQuery(selectedId ? { id: selectedId } : skipToken)

  const items = skills.data ?? []

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Skills"
        description="Skills in your global ~/.claude/skills folder."
        action={
          items.length > 0 ? (
            <span className="text-muted-foreground text-sm">{items.length} skills</span>
          ) : null
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="w-80 shrink-0 overflow-y-auto border-r p-3">
          {skills.isLoading ? (
            <p className="px-2 py-4 text-muted-foreground text-sm">Loading…</p>
          ) : skills.isError ? (
            <p className="px-2 py-4 text-destructive text-sm">Failed to load skills.</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-4 text-muted-foreground text-sm">
              No skills found in ~/.claude/skills.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((skill) => (
                <li key={skill.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(skill.id)}
                    className={cn(
                      'w-full rounded-md px-3 py-2 text-left transition-colors',
                      selectedId === skill.id ? 'bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-sm">{skill.name}</span>
                      {skill.allowedToolsCount > 0 ? (
                        <Badge>{`${skill.allowedToolsCount} tools`}</Badge>
                      ) : null}
                    </div>
                    {skill.description ? (
                      <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
                        {skill.description}
                      </p>
                    ) : null}
                    {skill.trigger || skill.argumentHint ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {skill.trigger ? <Badge tone="primary">{skill.trigger}</Badge> : null}
                        {skill.argumentHint ? <Badge>{skill.argumentHint}</Badge> : null}
                      </div>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-8">
          {!selectedId ? (
            <p className="text-muted-foreground text-sm">Select a skill to read its SKILL.md.</p>
          ) : detail.isLoading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : detail.isError ? (
            <p className="text-destructive text-sm">Failed to load skill.</p>
          ) : detail.data ? (
            <article className={PROSE}>
              <Markdown remarkPlugins={[remarkGfm]}>{detail.data.content}</Markdown>
            </article>
          ) : null}
        </div>
      </div>
    </div>
  )
}
