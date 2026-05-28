import { trpc } from '@renderer/lib/trpc'
import { DataCard } from '@renderer/pages/info/DataCard'
import { Section } from '@renderer/pages/info/Section'

const pct = (x: number | null): string => (x == null ? '—' : `${x.toFixed(2)}%`)
const r2Fmt = (x: number | null): string => (x == null ? '—' : x.toFixed(3))
const fmtCovPct = (num: number, denom: number): string =>
  denom === 0 ? '—' : `${num} / ${denom} (${((num / denom) * 100).toFixed(0)}%)`

export function Reliability() {
  const q = trpc.productivity.kpiDiagnostics.useQuery()
  const fit = q.data?.fit
  const inv = q.data?.dataInventory

  return (
    <Section id="reliability" title="7. Надёжность">
      <h4>(а) Качество подгонки</h4>
      <DataCard
        title="goodness-of-fit (live)"
        loading={q.isLoading}
        empty={fit == null ? 'нет данных' : null}
        rows={
          fit
            ? [
                {
                  label: 'R² (in-sample, log scale)',
                  value: r2Fmt(fit.r2LogScale),
                  hint: 'R² на обучающем периоде. Это не predictive R²; показывает, насколько модель описала свой бейзлайн.',
                },
                {
                  label: 'Median |residual| / expected',
                  value: pct(fit.medianAbsResidualPct),
                  hint: 'Типичная ошибка модели в линейном масштабе токенов.',
                },
                { label: 'Samples used (n*)', value: fit.samplesUsed },
              ]
            : []
        }
      />

      <h4 className="mt-16">(б) Покрытие данных</h4>
      <DataCard
        title="coverage (live)"
        loading={q.isLoading}
        empty={inv == null ? 'нет данных' : null}
        rows={
          inv
            ? [
                {
                  label: 'sessions with score',
                  value: fmtCovPct(inv.sessionsWithScore, inv.sessionsTotal),
                },
                {
                  label: 'sessions with difficulty',
                  value: fmtCovPct(inv.sessionsWithDifficulty, inv.sessionsTotal),
                },
                {
                  label: 'sessions with scope (files+dirs > 0)',
                  value: fmtCovPct(inv.sessionsWithScope, inv.sessionsTotal),
                },
              ]
            : []
        }
      />
      <p className="mt-8" style={{ color: 'var(--color-muted-fg)' }}>
        Сессии без записанной информации о scope получают expected по сохранённой median — иначе
        линия Eff схлопывалась бы только на скоуп-тегнутых днях.
      </p>

      <h4 className="mt-16">(в) Irreducible noise</h4>
      <ul>
        <li>
          <b>Cache hits/misses.</b> Eff считает суммарные <code>tokensIn + tokensOut</code>, кэш не
          различается. Холодный/горячий старт даёт ×2 разницу при одинаковом scope.
        </li>
        <li>
          <b>Extended thinking.</b> Thinking-токены входят в <code>tokensOut</code>. Сессии с
          thinking «дороже» при том же scope.
        </li>
        <li>
          <b>Autocompact.</b> Длинная сессия может включать autocompact, который мы не различаем в
          транскрипте.
        </li>
        <li>
          <b>Разные модели.</b> Модель сессии в схеме <code>agent_sessions</code> сейчас не
          сохраняется (см. <code>src/main/db/schema.ts</code>) — Eff трактует Opus и Haiku
          взаимозаменяемо, что неверно по факту.
        </li>
      </ul>

      <h4 className="mt-16">(г) Что НЕ входит в расчёт Eff</h4>
      <ul>
        <li>
          <code>cacheReadTokens</code> / <code>cacheCreationTokens</code> — есть только в{' '}
          <code>benchmark_runs</code>, не в <code>agent_turns</code>.
        </li>
        <li>
          <code>durationMs</code> / latency.
        </li>
        <li>
          <code>score</code> (1–10) — отдельная guardrail-линия рядом, не мультипликатор.
        </li>
        <li>Ошибки агента, прерывания, rollback'и.</li>
      </ul>
    </Section>
  )
}
