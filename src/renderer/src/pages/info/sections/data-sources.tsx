import { Section } from '@renderer/pages/info/Section'

export function DataSources() {
  return (
    <Section id="data-sources" title="2. Источники данных">
      <p>Atlas собирает данные из трёх независимых источников:</p>
      <div className="kv mt-8" style={{ gridTemplateColumns: '220px 1fr', rowGap: 12 }}>
        <div className="k">Транскрипты Claude Code</div>
        <div className="v">
          <code>{'~/.claude/projects/**/*.jsonl'}</code> — источник истины для токенов,
          использованных тулз, файлов и скиллов. Парсер:{' '}
          <code>src/main/services/productivity/transcript.ts</code>.
        </div>
        <div className="k">JSONL-буфер хуков</div>
        <div className="v">
          <code>~/agent-analytics/sessions/&lt;id&gt;.jsonl</code> — лайфцикл сессий (start / end),
          пользовательская оценка score и summary через <code>/done</code>. Парсер:{' '}
          <code>src/main/services/productivity/jsonl.ts</code>.
        </div>
        <div className="k">Watcher экосистемы</div>
        <div className="v">
          Диффит <code>~/.claude/settings.json</code> (enabledPlugins), <code>~/.claude.json</code>{' '}
          (mcpServers / mcpServersDisabled) и mtimes файлов в <code>~/.claude/skills/</code>{' '}
          относительно сохранённого snapshot. Источник:{' '}
          <code>src/main/services/productivity/infra.ts</code>.
        </div>
      </div>
      <p className="mt-12" style={{ color: 'var(--color-muted-fg)' }}>
        Транскрипты — источник истины. При расхождении они выигрывают.
      </p>
    </Section>
  )
}
