import { trpc } from '@renderer/lib/trpc'
import { formatDate as fmtDate } from '@renderer/lib/utils'
import { DataCard } from '@renderer/pages/info/DataCard'
import { Section } from '@renderer/pages/info/Section'

const fmtInt = (n: number): string => n.toLocaleString('ru-RU')

export function DataInventory() {
  const q = trpc.productivity.kpiDiagnostics.useQuery()
  const inv = q.data?.dataInventory

  return (
    <Section id="data-inventory" title="10. Полная инвентаризация данных">
      <DataCard
        title="inventory (live)"
        loading={q.isLoading}
        empty={inv == null ? 'нет данных' : null}
        rows={
          inv
            ? [
                { label: 'sessions total', value: fmtInt(inv.sessionsTotal) },
                { label: 'turns total', value: fmtInt(inv.turnsTotal) },
                { label: 'tokens in total', value: fmtInt(inv.tokensInTotal) },
                { label: 'tokens out total', value: fmtInt(inv.tokensOutTotal) },
                {
                  label: 'period (earliest … latest)',
                  value: `${fmtDate(inv.earliestSessionTs)} … ${fmtDate(inv.latestSessionTs)}`,
                },
                { label: 'sessions with scope', value: fmtInt(inv.sessionsWithScope) },
                { label: 'sessions with user score', value: fmtInt(inv.sessionsWithScore) },
                { label: 'sessions with difficulty', value: fmtInt(inv.sessionsWithDifficulty) },
                {
                  label: 'ecosystem changes total',
                  value: fmtInt(inv.ecosystemChangesTotal),
                },
              ]
            : []
        }
      />
    </Section>
  )
}
