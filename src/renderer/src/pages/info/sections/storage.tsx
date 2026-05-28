import { Section } from '@renderer/pages/info/Section'

export function Storage() {
  return (
    <Section id="storage" title="3. Что мы храним">
      <p>
        Все данные — в локальной SQLite по адресу{' '}
        <code>~/Library/Application Support/atlas-os/atlas.db</code>. Схема Drizzle:{' '}
        <code>src/main/db/schema.ts</code>.
      </p>

      <table className="info-table mt-12">
        <thead>
          <tr>
            <th>Таблица</th>
            <th>Что в ней</th>
            <th>Ключевые поля</th>
            <th>Источник</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>agent_turns</code>
            </td>
            <td>один turn агента</td>
            <td>
              <code>
                {'sessionId, ts, tokensIn, tokensOut, toolsUsed[], skillsUsed[], filesTouched[]'}
              </code>
            </td>
            <td>транскрипт</td>
          </tr>
          <tr>
            <td>
              <code>agent_sessions</code>
            </td>
            <td>одна сессия (агрегат)</td>
            <td>
              <code>
                {
                  'score 1–10, difficulty 1–10, totalTokensIn/Out, turnCount, distinctFiles, distinctDirs, distinctTools, distinctSkills, subagentCount'
                }
              </code>
            </td>
            <td>агрегат turns + хуки + ручной ввод</td>
          </tr>
          <tr>
            <td>
              <code>ecosystem_changes</code>
            </td>
            <td>одно изменение экосистемы</td>
            <td>
              <code>ts, type, target, diff, note</code>
            </td>
            <td>watcher + ручной ввод</td>
          </tr>
          <tr>
            <td>
              <code>kpi_baseline</code>
            </td>
            <td>замороженный бейзлайн per scope</td>
            <td>
              <code>
                {'scope, method, params (JSON), periodStart/End, sessionCount, createdAt'}
              </code>
            </td>
            <td>derived, freeze-on-first-use</td>
          </tr>
        </tbody>
      </table>

      <p className="mt-12" style={{ color: 'var(--color-muted-fg)' }}>
        id транскриптных turn'ов детерминированы (hash от sessionId + turnIndex). Повторный парсинг
        растущего файла идемпотентен — повторных строк не возникает.
      </p>
    </Section>
  )
}
