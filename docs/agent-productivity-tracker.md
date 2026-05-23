# Agent Productivity Tracker (Atlas-hosted)

> **Версия дизайна:** Atlas-adapted (2026-05-23).
> Исходный standalone-дизайн (Python + `sync.py` + статик HTML-дашборд) переработан:
> сбор данных живёт в тонких хуках Claude Code, **вся обработка, хранение и визуализация —
> внутри Atlas OS**. История решений и почему — см. ниже «Что изменилось против standalone».

## Что это и зачем

Agent Productivity Tracker — observability-слой для агентской OS на базе Claude Code.
Задача: измерять, как изменения в рабочей экосистеме влияют на качество работы агента и
потребление токенов — по всем параллельным проектам сразу.

### Проблема

При активной работе с Claude Code постоянно происходят изменения: подключаются новые
MCP-серверы, редактируются скиллы, меняются инструкции в CLAUDE.md, экспериментируются
новые подходы к промптам. Объективно ответить нельзя:

- Стало ли лучше после подключения нового MCP?
- Какой проект потребляет больше всего токенов и почему?
- Коррелирует ли сложность задачи с качеством результата?
- Какие скиллы реально используются, а какие лежат мёртвым грузом?

### Решение

Тонкие хуки фиксируют жизненный цикл сессий и изменения экосистемы в append-only JSONL.
**Atlas** парсит транскрипты Claude Code как источник истины, инжестит всё в свою SQLite
(Drizzle) и показывает аналитику на страницах Productivity и Ecosystem (Recharts).

### Масштаб

~5 параллельных проектов. Каждый логируется независимо (по полному пути), анализируются вместе.

---

## Архитектура

### Граница системы

Два **сырых источника** данных; Atlas сводит оба в одну БД:

```
ИСТОЧНИК A — транскрипты Claude Code (CC владеет, per-turn истина)
  ~/.claude/projects/<encoded-cwd>/<session>.jsonl
     └─ tokens_in/out, tool_use, Skill-вызовы, тайминги

ИСТОЧНИК B — наши тонкие хуки (append-only буфер)
  ~/agent-analytics/
    sessions.jsonl            ← lifecycle (start/end) + score/summary из /done
    ecosystem-changes.jsonl   ← правки settings (ConfigChange) и скиллов (FileChanged)

                  ┌──────────────────────────────────────────┐
   A ─┐           │  Atlas main (Node)                        │
      ├─ ingest ─▶│   transcript parser  ──┐                  │
   B ─┘           │   jsonl reader      ───┼─▶ Drizzle (atlas.db)
                  │                        │      │           │
                  │   productivity tRPC ◀──┘      │           │
                  └───────────────┬───────────────┘           │
                                  │ tRPC (Zod in/out)          │
                  ┌───────────────▼───────────────────────────┘
                  │  Renderer: Productivity + Ecosystem (Recharts)
                  └────────────────────────────────────────────
```

### Принцип работы

1. Хуки CC пишут lifecycle/ecosystem в JSONL-буфер (`~/agent-analytics/`). Дёшево, без зависимостей, работает даже когда Atlas закрыт.
2. Claude Code сам пишет полные транскрипты в `~/.claude/projects/**` — это источник per-turn метрик (токены/tools/skills).
3. Atlas при старте и по кнопке **Refresh** инжестит: парсит транскрипты + читает JSONL-буфер → пишет в `atlas.db` (идемпотентно).
4. Страницы Productivity/Ecosystem читают агрегаты через `productivity.*` tRPC и рисуют графики.

### Почему так

- **Хуки тонкие** — фаерят глобально по всем проектам, должны быть быстрыми и без зависимостей; не должны зависеть от запущенного Atlas.
- **Транскрипт = истина** — tools/skills/токены лежат в нём объективно; не полагаемся на самодекларацию агента.
- **Atlas владеет хранением и UI** — у него уже есть SQLite/Drizzle/tRPC/Recharts и страница Stats как паттерн. Второй стек (Python+статик-HTML) не нужен.

### Идентификация проекта

`project_path` = полный cwd, декодируется из имени папки транскрипта
(`~/.claude/projects/<encoded-cwd>/`) либо берётся из `cwd` хука. В UI показывается
`basename`. Полный путь как ключ исключает коллизии одноимённых папок.

---

## Хуки Claude Code

Регистрируются в `~/.claude/settings.json`, глобальные. Все — тонкие: пишут одну
JSON-строку и выходят. **Нет `Stop`-хука. Нет `[TRACK]`. Нет секции в CLAUDE.md.**

| Хук | Когда | Что пишет | Куда |
|---|---|---|---|
| `SessionStart` | старт/resume | `session_id`, `started_at`, `project_path`, snapshot конфигов (baseline для diff) | `sessions.jsonl` (открытая запись) |
| `SessionEnd` | завершение | `ended_at`, `reason` | `sessions.jsonl` (финализация) |
| `ConfigChange` | правка settings | `source`, `file_path`, diff | `ecosystem-changes.jsonl` |
| `FileChanged` | правка файла скилла | `file_path` (matcher на путях скиллов) | `ecosystem-changes.jsonl` |
| `/done` (скилл) | юзер завершает | `score` (1–10) + `summary` | `sessions.jsonl` (финализация) |

### Почему именно эти

- **Нет `Stop`** — мутация файла транскрипта *и есть* факт turn'а. Atlas парсит транскрипт при инжесте, отдельный per-turn хук избыточен.
- **`FileChanged` для скиллов, не `ConfigChange`** — у `ConfigChange.source` значения только `project_settings|local_settings|user_settings|policy_settings`, скиллов там нет. Скиллы — файлы → ловим `FileChanged` по их путям.
- **`ConfigChange` реален** — поля `source`, `file_path`; умеет блокировать (exit 2 / `{"decision":"block"}`), но мы используем только для аудита (не блокируем).

### SessionStart

**Матчер:** `startup|resume`

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "startup|resume",
        "hooks": [{ "type": "command", "command": "${HOME}/.claude/hooks/session-start-hook.py" }] }
    ]
  }
}
```

Вход от Claude Code: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `source`.

### SessionEnd

**Матчер:** `prompt_input_exit|clear|logout|other`
Вход: `+ reason`. Не блокирует выход, таймаут 1.5с — только финализация записи (`ended_at`, `reason`).

### ConfigChange

**Матчер:** `project_settings|local_settings|user_settings`
Вход: `source`, `file_path`. Пишет `ecosystem-changes.jsonl` с `type` (`config_changed`/`claude_md_edited` по `file_path`).

### FileChanged

**Матчер:** пути скиллов (`*/.claude/skills/*`, `*/skills/*/SKILL.md`).
Маппинг на `type`: `skill_added|skill_edited|skill_removed`.

---

## Скилл `/done`

Завершает сессию с оценкой. Терминальный, требует явного вызова.

```
$ /done
> score (1-10)? 8
> summary?      Рефакторинг авторизации — вынес в отдельный сервис
✓ session finalized
```

Пишет финализацию в `~/agent-analytics/sessions.jsonl` (`score`, `summary`). Atlas
подхватывает тем же инжестом — единый путь, без отдельного механизма.

> `complexity` здесь **не спрашиваем** — выводится Atlas'ом эвристически (см. ниже).

---

## Источник истины: парсинг транскрипта

Atlas парсит `~/.claude/projects/**/*.jsonl` и реконструирует per-turn события.

| Метрика | Откуда в транскрипте |
|---|---|
| `tokens_in` | Σ по assistant-сообщениям turn'а: `input_tokens + cache_creation_input_tokens`. `cache_read_input_tokens` **исключён** — суммируясь по agentic-loop, дешёвый повторный рид кэша раздувает число до сотен млн и делает метрику бессмысленной (проверено на реальных транскриптах). |
| `tokens_out` | Σ `output_tokens` по assistant-сообщениям turn'а |
| `tools_used` | блоки `tool_use` (без `Skill`), distinct |
| `skills_used` | вызовы инструмента `Skill` (`input.skill`), distinct |
| `turn_index` | порядковый номер turn'а в сессии (стабилен) |
| `complexity_proxy` | вычисляется (см. ниже), **не декларируется** |

### `complexity_proxy`

Объективная прокси-оценка усилия (не «истинная сложность»):

```
complexity_proxy = f(turn_count, distinct_tools, files_touched, tokens_total)
```

Точная формула/веса — **открытый вопрос** (см. TODO). Считается при инжесте, хранится в строке turn'а или агрегатом сессии.

### Идемпотентность

Транскрипт растёт, перечитывается при каждом инжесте. Чтобы реинжест не плодил дубли:

```
turn.id = hash(session_id + ":" + turn_index)   // детерминированный, НЕ random UUID
```

Запись через `INSERT … ON CONFLICT DO NOTHING` (Drizzle `onConflictDoNothing`).

---

## Хранилище: Drizzle SQLite (atlas.db)

Всё в общей БД Atlas (`<userData>/atlas.db`) — отдельный `analytics.db` не нужен.
Имена таблиц не конфликтуют с существующей `events` (она про generic AI-actions Atlas).

`src/main/db/schema.ts` (добавить к существующему):

```ts
import { integer, sqliteTable, text, real } from 'drizzle-orm/sqlite-core'

// Один turn агента (реконструируется из транскрипта).
export const agentTurns = sqliteTable('agent_turns', {
  id: text('id').primaryKey(),                    // hash(session_id + turn_index)
  sessionId: text('session_id').notNull(),
  projectPath: text('project_path').notNull(),
  turnIndex: integer('turn_index').notNull(),
  ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  toolsUsed: text('tools_used', { mode: 'json' }).$type<string[]>().notNull(),
  skillsUsed: text('skills_used', { mode: 'json' }).$type<string[]>().notNull(),
  complexityProxy: real('complexity_proxy'),
})

// Итог сессии (lifecycle из хуков + score/summary из /done + агрегаты из turns).
export const agentSessions = sqliteTable('agent_sessions', {
  sessionId: text('session_id').primaryKey(),
  projectPath: text('project_path').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
  endReason: text('end_reason'),
  score: integer('score'),                        // 1–10, из /done; null пока не оценено
  summary: text('summary'),
  totalTokensIn: integer('total_tokens_in').notNull().default(0),
  totalTokensOut: integer('total_tokens_out').notNull().default(0),
  turnCount: integer('turn_count').notNull().default(0),
  avgComplexity: real('avg_complexity'),
})

// Изменение экосистемы (ConfigChange / FileChanged / ручная заметка из UI).
export const ecosystemChanges = sqliteTable('ecosystem_changes', {
  id: text('id').primaryKey(),                    // детерминированный по содержимому
  ts: integer('ts', { mode: 'timestamp_ms' }).notNull(),
  type: text('type').notNull(),                   // см. таблицу значений
  target: text('target'),
  source: text('source'),                         // 'auto' | 'manual'
  diff: text('diff'),
  note: text('note'),
})

export type AgentTurnRow = typeof agentTurns.$inferSelect
export type AgentSessionRow = typeof agentSessions.$inferSelect
export type EcosystemChangeRow = typeof ecosystemChanges.$inferSelect
```

Миграция: `pnpm db:generate` (drizzle-kit) → `./drizzle`.

**Значения `ecosystem_changes.type`:** `mcp_added`, `mcp_removed`, `skill_added`,
`skill_edited`, `skill_removed`, `config_changed`, `claude_md_edited`, `manual_note`.

---

## Сервис инжеста (вместо `sync.py`)

TS в main: `src/main/services/productivity/`.

```
ingest.ts            оркестратор: parse транскрипты + read JSONL → upsert в Drizzle
transcript.ts        парсер ~/.claude/projects/**/*.jsonl → AgentTurn[]
jsonl.ts             reader ~/agent-analytics/*.jsonl → sessions/ecosystem
complexity.ts        complexity_proxy
```

- **Триггер:** при старте приложения (`app.on('ready')`) + tRPC-мутация `productivity.refresh` (кнопка Refresh в UI). Без fs.watch.
- **Идемпотентность:** детерминированные id + `onConflictDoNothing`. Повторный инжест безопасен.
- **Агрегаты сессии** (`turn_count`, `total_tokens_*`, `avg_complexity`) пересчитываются из `agent_turns` при инжесте.

---

## tRPC: `productivity` router

`src/main/trpc/routers/productivity.ts`, регистрируется в `src/main/trpc/router.ts`.

```ts
export const productivityRouter = router({
  refresh:        publicProcedure.mutation(/* запускает ingest, возвращает счётчики */),

  overview:       publicProcedure // по всем проектам: токены/день, avg score, avg complexity
    .input(z.object({ days: z.number().default(30) }))
    .output(/* серии для графиков */),

  byProject:      publicProcedure // детально по одному проекту
    .input(z.object({ projectPath: z.string(), days: z.number().default(30) })),

  sessions:       publicProcedure // список сессий (с score/summary)
    .input(z.object({ projectPath: z.string().optional() })),

  toolSkillUsage: publicProcedure // частота tools/skills
    .input(z.object({ projectPath: z.string().optional() })),

  ecosystem:      publicProcedure // таймлайн изменений для наложения на метрики
    .input(z.object({ days: z.number().default(90) })),

  addNote:        publicProcedure // ручная заметка на таймлайн (manual_note)
    .input(z.object({ ts: z.date(), note: z.string() })).mutation(/* … */),
})
```

---

## UI: страницы рендерера

`src/renderer/src/pages/` (паттерн как `Stats.tsx`, графики Recharts):

**Productivity.tsx**
- Обзор (все проекты): токены/день по проектам, динамика avg complexity, avg score по проектам.
- Детально (проект): токены и сложность по сессиям; частота tools/skills; история score.
- Кнопка **Refresh** → `productivity.refresh`.

**Ecosystem.tsx** (или таб внутри Productivity)
- Таймлайн изменений (MCP/скиллы/конфиги/ручные заметки).
- Наложение на график score/токенов — видеть корреляцию «изменение → эффект».
- Добавление ручной заметки → `productivity.addNote`.

### Фильтры и отслеживаемые проекты

- **Диапазон** 1d/7d/30d и **фильтр проекта** на странице Productivity. Окно считается по `agent_turns.ts` (не по `started_at`, который null без хуков), поэтому работает и без установленных хуков.
- **Tracked projects (allowlist)** — в Settings (`settings.trackedProjects: string[]`, пусто = все). Productivity-вьюхи (overview/sessions/toolSkillUsage/byProject + дропдаун проектов) считают только отслеживаемые проекты. Ecosystem — глобальный, не фильтруется проектом.
- **Ingest пишет ВСЕ проекты** (история не теряется при переключении allowlist); фильтрация — только на чтении. `productivity.discoverProjects` отдаёт полный список для пикера в Settings; `productivity.projects` — только отслеживаемые для дропдауна.

---

## Этапы реализации

| Этап | Что делаем | Результат |
|---|---|---|
| 1 | Тонкие хуки: `SessionStart`, `SessionEnd`, `ConfigChange`, `FileChanged` | JSONL-буфер копится |
| 2 | Drizzle-схема (`agent_turns`/`agent_sessions`/`ecosystem_changes`) + миграция | Таблицы готовы |
| 3 | Сервис инжеста (transcript parser + jsonl reader) + `productivity.refresh` | Данные в `atlas.db` |
| 4 | `productivity` tRPC router (overview/byProject/sessions/usage/ecosystem) | Запросы доступны |
| 5 | Страницы Productivity + Ecosystem (Recharts) | Визуализация |
| 6 | Скилл `/done` (score + summary) | Появляется субъективная оценка |

### Зависимости

- Этап 1 даёт ценность сразу (буфер копится без Atlas).
- Этапы 3–5 — основная работа внутри Atlas; 4 требует 2–3, 5 требует 4.
- Этап 6 независим — `score`/`summary` остаются `null` пока скилла нет.

---

## Открытые вопросы (TODO)

- **Формула `complexity_proxy`** — точные веса по `turn_count`/`tools`/`files`/`tokens`; калибровка по реальным данным.
- **Парсинг `usage` из транскрипта** — зафиксировать формат строк CC (per-turn токены), устойчивость к смене версии.
- **`manual_note`** — реализуется в UI Atlas на таймлайне (`productivity.addNote`), не в хуках.
- **MCP add/remove** — `mcp_added`/`mcp_removed` ловятся через `ConfigChange` на `.mcp.json` или diff snapshot'а из `SessionStart`; уточнить.

---

## Что изменилось против standalone-дизайна

| Было (standalone) | Стало (Atlas) | Почему |
|---|---|---|
| `Stop`-хук парсит каждый turn | Нет `Stop`; Atlas парсит транскрипт | Транскрипт = истина, хук избыточен |
| `[TRACK]` + секция в CLAUDE.md | Удалено; `complexity_proxy` вычисляется | Самодекларация ненадёжна, налог на каждый ответ |
| tools/skills из декларации агента | Парсятся из транскрипта объективно | Точность |
| `sync.py` (Python) | TS ingest-сервис в main | Один стек, типобезопасность |
| Отдельный `analytics.db` | Общая `atlas.db` (Drizzle) | У Atlas уже есть БД |
| Статик HTML + `python -m http.server` | Страницы Atlas на Recharts | У Atlas уже есть UI/Stats-паттерн |
| `id` = random UUID в хуке | `id` = `hash(session_id+turn_index)` | Идемпотентный реинжест растущего транскрипта |
| `project_id` = `basename(cwd)` | `project_path` = полный путь | Нет коллизий одноимённых папок |
| score через перехват `/exit` (TODO) | score через скилл `/done` + nullable | `SessionEnd` не блокирует/не спрашивает |
| ecosystem только `ConfigChange` | `ConfigChange` (settings) + `FileChanged` (скиллы) | У `ConfigChange.source` нет скиллов |
