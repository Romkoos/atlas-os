import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { MarkdownView } from '@renderer/pages/knowledge/MarkdownView'
import type { ArticleKind, ArticleMeta } from '@shared/knowledge'
import { type ReactNode, useMemo, useState } from 'react'

type Tab = 'browse' | 'daily' | 'search'

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'browse', label: './browse' },
  { id: 'daily', label: './daily' },
  { id: 'search', label: './search' },
]

const KIND_LABEL: Record<ArticleKind, string> = {
  concept: 'CONCEPTS',
  connection: 'CONNECTIONS',
  qa: 'Q&A',
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="panel mt-16">
      <div className="panel-body">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-3)' }}>
          <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
          {children}
        </div>
      </div>
    </div>
  )
}

export function Knowledge() {
  const projects = trpc.knowledge.projects.useQuery()
  const [project, setProject] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('browse')

  const active = project ?? projects.data?.[0]?.name ?? null

  return (
    <>
      <PageHeader
        num="04"
        title="knowledge"
        description="Per-project knowledge base — read-only."
        action={
          projects.data && projects.data.length > 0 ? (
            <select
              className="select"
              value={active ?? ''}
              onChange={(e) => setProject(e.target.value)}
            >
              {projects.data.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.articleCount})
                </option>
              ))}
            </select>
          ) : null
        }
      />

      {projects.isPending ? (
        <Empty>loading…</Empty>
      ) : projects.data && projects.data.length > 0 ? (
        !active ? null : (
          <>
            <div className="tabs">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tab === t.id ? 'tab tab-active' : 'tab'}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tab === 'browse' && <BrowseTab key={active} project={active} />}
            {tab === 'daily' && <DailyTab key={active} project={active} />}
            {tab === 'search' && <SearchTab key={active} project={active} />}
          </>
        )
      ) : (
        <Empty>no tracked projects with a knowledge base yet.</Empty>
      )}
    </>
  )
}

function BrowseTab({ project }: { project: string }) {
  const list = trpc.knowledge.list.useQuery({ project })
  const index = trpc.knowledge.index.useQuery({ project })
  const [selected, setSelected] = useState<string | null>(null)
  const article = trpc.knowledge.article.useQuery(
    { project, relPath: selected ?? '' },
    { enabled: selected != null },
  )

  const articles: ArticleMeta[] = list.data ?? []
  const groups = useMemo(() => {
    const by: Record<ArticleKind, ArticleMeta[]> = { concept: [], connection: [], qa: [] }
    for (const a of articles) by[a.kind].push(a)
    return by
  }, [articles])

  if (articles.length === 0) {
    return (
      <Empty>
        this knowledge base is empty. It compiles from your Claude Code sessions — check the ./daily
        tab for raw logs.
      </Empty>
    )
  }

  return (
    <div className="kb-layout">
      <nav className="kb-list">
        {(['concept', 'connection', 'qa'] as ArticleKind[]).map((kind) =>
          groups[kind].length === 0 ? null : (
            <div key={kind} className="kb-group">
              <div className="kb-group-title">{KIND_LABEL[kind]}</div>
              {groups[kind].map((a) => (
                <button
                  key={a.relPath}
                  type="button"
                  className={selected === a.relPath ? 'kb-item kb-item-active' : 'kb-item'}
                  onClick={() => setSelected(a.relPath)}
                >
                  <span className="kb-item-title">{a.title}</span>
                  {a.inboundLinks > 0 && <span className="kb-item-meta">←{a.inboundLinks}</span>}
                </button>
              ))}
            </div>
          ),
        )}
      </nav>
      <section className="kb-pane">
        {selected && article.data ? (
          <MarkdownView
            body={article.data.body}
            frontmatter={article.data.frontmatter}
            articles={articles}
            onNavigate={setSelected}
          />
        ) : (
          <MarkdownView body={index.data?.raw ?? ''} articles={articles} onNavigate={setSelected} />
        )}
      </section>
    </div>
  )
}

function DailyTab({ project }: { project: string }) {
  const daily = trpc.knowledge.daily.useQuery({ project })
  const [selected, setSelected] = useState<string | null>(null)

  const entries = daily.data ?? []
  const resolvedPath = selected ?? entries[0]?.relPath ?? null
  const doc = trpc.knowledge.dailyArticle.useQuery(
    { project, relPath: resolvedPath ?? '' },
    { enabled: resolvedPath != null },
  )

  if (entries.length === 0) return <Empty>no daily logs for this project yet.</Empty>

  return (
    <div className="kb-layout">
      <nav className="kb-list">
        {entries.map((d) => (
          <button
            key={d.relPath}
            type="button"
            className={resolvedPath === d.relPath ? 'kb-item kb-item-active' : 'kb-item'}
            onClick={() => setSelected(d.relPath)}
          >
            <span className="kb-item-title">{d.date}</span>
          </button>
        ))}
      </nav>
      <section className="kb-pane">
        <MarkdownView body={doc.data?.raw ?? ''} articles={[]} onNavigate={() => {}} />
      </section>
    </div>
  )
}

function SearchTab({ project }: { project: string }) {
  const [q, setQ] = useState('')
  const query = trpc.knowledge.query.useMutation()

  return (
    <div className="kb-search">
      <div className="kb-search-warn">
        <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
        runs the engine and spends API tokens. Fires only on submit.
      </div>
      <form
        className="kb-search-bar"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) query.mutate({ project, q: q.trim() })
        }}
      >
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask the knowledge base…"
        />
        <button type="submit" className="btn" disabled={query.isPending || !q.trim()}>
          {query.isPending ? 'running…' : 'search'}
        </button>
      </form>
      {query.error && (
        <div className="panel mt-16">
          <div className="panel-body" style={{ color: 'var(--red, #e66)' }}>
            {query.error.message}
          </div>
        </div>
      )}
      {query.data && (
        <section className="kb-pane mt-16">
          <MarkdownView body={query.data.answer} articles={[]} onNavigate={() => {}} />
        </section>
      )}
    </div>
  )
}
