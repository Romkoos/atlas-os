import { type ArticleMeta, resolveWikilink } from '@shared/knowledge'
import { type ComponentPropsWithoutRef, useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const WIKI = /\[\[([^\]]+)\]\]/g

// Rewrite [[target]] tokens: resolvable -> markdown link with a #wiki: href the
// <a> override turns into navigation; dangling -> inline code (rendered muted).
function preprocess(body: string, articles: ArticleMeta[]): string {
  return body.replace(WIKI, (_m, raw: string) => {
    const target = raw.trim()
    const rel = resolveWikilink(target, articles)
    return rel ? `[${target}](#wiki:${encodeURIComponent(rel)})` : `\`${target}\``
  })
}

type AnchorProps = ComponentPropsWithoutRef<'a'> & { node?: unknown }

export function MarkdownView({
  body,
  frontmatter,
  articles,
  onNavigate,
}: {
  body: string
  frontmatter?: Record<string, unknown>
  articles: ArticleMeta[]
  onNavigate: (relPath: string) => void
}) {
  const processed = useMemo(() => preprocess(body, articles), [body, articles])
  const tags = Array.isArray(frontmatter?.tags) ? (frontmatter?.tags as string[]) : []
  const sources = Array.isArray(frontmatter?.sources) ? (frontmatter?.sources as string[]) : []
  const updated = typeof frontmatter?.updated === 'string' ? frontmatter.updated : null

  const anchor = ({ node: _node, ...props }: AnchorProps) => {
    const href = props.href ?? ''
    if (href.startsWith('#wiki:')) {
      const rel = decodeURIComponent(href.slice('#wiki:'.length))
      return (
        <button type="button" className="wikilink" onClick={() => onNavigate(rel)}>
          {props.children}
        </button>
      )
    }
    return <a {...props} target="_blank" rel="noreferrer" />
  }

  return (
    <div className="kb-article">
      {(tags.length > 0 || updated || sources.length > 0) && (
        <div className="kb-fm">
          {tags.map((t) => (
            <span key={t} className="kb-chip">
              #{t}
            </span>
          ))}
          {updated && <span className="kb-fm-meta">updated {updated}</span>}
          {sources.length > 0 && <span className="kb-fm-meta">sources: {sources.join(', ')}</span>}
        </div>
      )}
      <div className="kb-md">
        <Markdown remarkPlugins={[remarkGfm]} components={{ a: anchor }}>
          {processed}
        </Markdown>
      </div>
    </div>
  )
}
