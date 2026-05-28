import { Section } from '@renderer/pages/info/Section'

const REFS: { path: string; what: string }[] = [
  {
    path: 'src/shared/kpi.ts',
    what: 'чистая математика: fitBaseline, expectedTokens, sessionKpd, kpdByDay, rollingMedian, r2LogScale, medianAbsResidualPct',
  },
  {
    path: 'src/main/services/productivity/baseline.ts',
    what: 'заморозка, активный бейзлайн, rebaseline, getScopedSessions',
  },
  {
    path: 'src/main/services/productivity/transcript.ts',
    what: 'парсинг транскриптов Claude Code',
  },
  {
    path: 'src/main/services/productivity/jsonl.ts',
    what: 'парсинг хуков (~/agent-analytics/sessions/)',
  },
  {
    path: 'src/main/services/productivity/infra.ts',
    what: 'watcher экосистемы (~/.claude/* diff vs snapshot)',
  },
  {
    path: 'src/main/trpc/routers/productivity.ts',
    what: 'tRPC эндпоинты: kpi, kpiDiagnostics, ecosystemImpact, rebaseline',
  },
]

export function CodeRefs() {
  return (
    <Section id="code-refs" title="11. Ссылки на код">
      <table className="info-table mt-8">
        <thead>
          <tr>
            <th>Файл</th>
            <th>Что внутри</th>
          </tr>
        </thead>
        <tbody>
          {REFS.map((r) => (
            <tr key={r.path}>
              <td>
                <code>{r.path}</code>
              </td>
              <td>{r.what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}
