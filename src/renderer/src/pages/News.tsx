import { PageHeader } from '@renderer/components/layout/PageHeader'
import { trpc } from '@renderer/lib/trpc'
import { formatDateTime } from '@renderer/lib/utils'
import { MarkdownView } from '@renderer/pages/knowledge/MarkdownView'
import { useNewsRun } from '@renderer/store/newsRun'
import { useTrendingRun } from '@renderer/store/trendingRun'
import { useUiStore } from '@renderer/store/ui'
import { useMemo } from 'react'

type FeedId = 'ai-news' | 'trending'

// Drop a leading `---\n…\n---` frontmatter block so a digest's `date:` header
// doesn't render as stray text above the title.
function stripFrontmatter(raw: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(raw)
  return m ? raw.slice(m[0].length) : raw
}

// Per-feed copy. The two feeds share the exact same machinery (a read query + a
// run store hosted at App level), so the page just swaps which one drives the UI.
const FEEDS: Record<
  FeedId,
  {
    label: string
    description: string
    warn: string
    runIdle: string
    runBusy: string
    empty: string
    streamHint: string
  }
> = {
  'ai-news': {
    label: 'AI NEWS',
    description: 'AI digest of the last 24 hours. Runs the daily-ai-news skill.',
    warn: 'runs Claude Code with the daily-ai-news skill (uses your Claude limit). The file is overwritten each run.',
    runIdle: 'REFRESH NEWS',
    runBusy: 'COLLECTING…',
    empty: 'no digest yet — press “REFRESH NEWS” to collect it.',
    streamHint: 'running the skill, searching for news…',
  },
  trending: {
    label: 'GITHUB TRENDING',
    description: 'Top 10 trending GitHub repositories this week. Runs the github-trending skill.',
    warn: 'runs Claude Code with the github-trending skill (uses your Claude limit). The file is overwritten each run.',
    runIdle: 'REFRESH TRENDS',
    runBusy: 'COLLECTING…',
    empty: 'no digest yet — press “REFRESH TRENDS” to collect it.',
    streamHint: 'running the skill, collecting trends…',
  },
}

export function News() {
  const storedFeed = useUiStore((s) => s.tabsBySection.news)
  const setTab = useUiStore((s) => s.setTab)
  const active: FeedId =
    storedFeed === 'trending' || storedFeed === 'ai-news' ? storedFeed : 'ai-news'
  const setActive = (id: FeedId) => setTab('news', id)

  // Both feeds' read queries and run stores are read unconditionally (hooks can't
  // be conditional); the active feed selects which set drives the render. Run
  // state lives in global stores driven by the App-level hosts, so a run survives
  // leaving and returning to this tab — and switching sub-tabs.
  const newsQuery = trpc.news.read.useQuery()
  const trendingQuery = trpc.trending.read.useQuery()
  const newsRun = useNewsRun()
  const trendingRun = useTrendingRun()

  const query = active === 'ai-news' ? newsQuery : trendingQuery
  const run = active === 'ai-news' ? newsRun : trendingRun
  const copy = FEEDS[active]

  const updatedAt = query.data?.updatedAt
  const hasDigest = Boolean(query.data?.raw)
  const body = useMemo(() => stripFrontmatter(query.data?.raw ?? ''), [query.data?.raw])

  return (
    <>
      <PageHeader
        num="05"
        title="NEWS"
        description={copy.description}
        action={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {updatedAt && !run.running && (
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-3)' }}>
                updated {formatDateTime(new Date(updatedAt))}
              </span>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={run.start}
              disabled={run.running}
            >
              <span className="arrow">▶</span>&nbsp;
              {run.running ? copy.runBusy : copy.runIdle}
            </button>
            {run.running && (
              <button type="button" className="btn" onClick={run.cancel}>
                ■ CANCEL
              </button>
            )}
          </div>
        }
      />

      <div className="tabs">
        {(Object.keys(FEEDS) as FeedId[]).map((id) => {
          const busy = id === 'ai-news' ? newsRun.running : trendingRun.running
          return (
            <button
              key={id}
              type="button"
              className={id === active ? 'on' : ''}
              onClick={() => setActive(id)}
            >
              {FEEDS[id].label}
              {busy && <span style={{ color: 'var(--amber-dim)' }}>&nbsp;●</span>}
            </button>
          )
        })}
      </div>

      <div className="scroll">
        <div className="kb-search-warn">
          <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
          {copy.warn}
        </div>

        {run.running ? (
          <div className="panel">
            <div className="panel-head">
              <span className="ttl">live</span>
              <span className="meta">● streaming…</span>
            </div>
            <div className="panel-body" style={{ minHeight: 180 }}>
              {run.output ? (
                <div
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 13,
                    lineHeight: 1.65,
                    color: 'var(--fg)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  <span style={{ color: 'var(--fg-4)' }}>{'>> '}</span>
                  {run.output}
                  <span className="caret" />
                </div>
              ) : (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--fg-4)' }}>
                  <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
                  {copy.streamHint}
                </div>
              )}
            </div>
          </div>
        ) : query.isPending ? (
          <Empty>loading…</Empty>
        ) : hasDigest ? (
          <section className="news-digest">
            <MarkdownView body={body} articles={[]} onNavigate={() => {}} />
          </section>
        ) : (
          <Empty>{copy.empty}</Empty>
        )}
      </div>
    </>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel mt-16">
      <div className="panel-body">
        <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-3)' }}>
          <span style={{ color: 'var(--amber-dim)' }}>{'// '}</span>
          {children}
        </div>
      </div>
    </div>
  )
}
