# INFO page — раздел Token Efficiency

**Дата:** 2026-05-28
**Скоуп:** добавить новый экран Atlas, объясняющий метрику Token Efficiency для внешнего читателя (математик, ревьюер). На данном этапе наполнен только раздел про Token Efficiency; остальные графики помечены `coming soon`.
**Невходит:** изменения формул, миграции БД, переработка существующего графика, popover у заголовка graph'а.

---

## 1. Цель

Дать математически грамотному читателю возможность за один присест понять:

1. что такое Token Efficiency (Eff),
2. какие сырые данные собирает Atlas и где их источник истины,
3. какие данные участвуют в расчёте Eff и какие сознательно вынесены за скобки,
4. как устроена baseline-модель и почему именно так,
5. насколько надёжны числа на графике в Productivity → Token efficiency.

Страница самодостаточна: ссылок на сторонние документы не требует.

---

## 2. Размещение

Новый раздел сайдбара:

```
01 · DASHBOARD
02 · STATS
03 · PRODUCTIVITY
04 · INFO          ← вставка здесь
05 · SKILLS
06 · SETTINGS
```

Inserting INFO как `04` сохраняет контекстную близость к PRODUCTIVITY (математик придёт оттуда). Старые порядковые номера `04/05` сдвигаются на `05/06`. Cmd+1..6 продолжают работать по индексу.

Изменения:

- `src/renderer/src/store/ui.ts` — добавить `'info'` в union `Section`.
- `src/renderer/src/components/layout/nav.ts` — добавить элемент `{ id: 'info', key: '04', label: 'INFO' }` со сдвигом ключей `skills→05`, `settings→06`.
- `src/renderer/src/App.tsx` — зарегистрировать `Info` в `PAGES`.

---

## 3. Backend: новый tRPC endpoint

Добавить процедуру в `src/main/trpc/routers/productivity.ts`:

```ts
productivity.kpiDiagnostics
  input: z.object({ projectPath: z.string().optional() }).optional()
  output: KpiDiagnostics
```

Тип ответа:

```ts
interface KpiDiagnostics {
  baseline: {
    scope: string                  // projectPath или '__global__'
    method: 'scope' | 'global-median'
    params: {
      a?: number; bFiles?: number; bDirs?: number; median?: number
    }
    periodStart: number | null     // ms epoch (lastTs первой baseline-сессии)
    periodEnd: number | null
    sessionCount: number           // сколько сессий ушло в подгонку
    createdAt: number              // когда заморозили
  } | null

  fit: {
    r2LogScale: number | null      // R² на log(actualTokens), null для median и при n<3
    samplesUsed: number
    medianAbsResidualPct: number | null  // median(|actual-expected|/expected) на сэмплах baseline
    samplesPreview: Array<{
      files: number
      dirs: number
      actualTokens: number
      expectedTokens: number
    }>                              // до 50 сэмплов для возможного scatter plot
  }

  dataInventory: {
    sessionsTotal: number
    sessionsWithScope: number       // distinctFiles > 0 OR distinctDirs > 0
    sessionsWithScore: number       // score != null
    sessionsWithDifficulty: number  // difficulty != null
    turnsTotal: number
    tokensInTotal: number
    tokensOutTotal: number
    ecosystemChangesTotal: number
    earliestSessionTs: number | null
    latestSessionTs: number | null
  }
}
```

Поведение:

- Если baseline для скоупа отсутствует, поле `baseline` = `null` (страница покажет «модель ещё не зафиксирована»).
- `r2LogScale` для метода `scope`: использовать те же `samplesUsed`, что были при заморозке (отобрать через `selectBaselineSamples` на тех же `ScopedSession[]`). Это значит, что R² — это в-сэмпл-фит на периоде заморозки, не предсказательное R² на новых данных. Это сознательная честная цифра — она показывает, насколько модель описала свой обучающий период; математик это поймёт. Формула:
  - `ŷᵢ = a + bFiles·log1p(filesᵢ) + bDirs·log1p(dirsᵢ)`
  - `yᵢ = log(actualTokensᵢ)`
  - `R² = 1 − Σ(yᵢ − ŷᵢ)² / Σ(yᵢ − ȳ)²`
- `medianAbsResidualPct` — на той же выборке: `median(|actualᵢ − expectedᵢ| / expectedᵢ) × 100`. Это «типичная ошибка» в линейном масштабе токенов, легче интерпретируется чем R² на логах.
- `samplesPreview` — все baseline-сэмплы (для среднего проекта это ≤ ~50 сессий, размер ответа в пределах 5 КБ).

Чистая математика по подсчёту R² и медианного остатка — в `src/shared/kpi.ts` как **новые экспортируемые функции** `r2LogScale(samples, model)` и `medianAbsResidualPct(samples, model)`. Это нужно для unit-тестов.

Endpoint реиспользует существующий путь сбора `ScopedSession[]` (в роутере уже есть приватный селектор для kpi/ecosystemImpact/rebaseline на строке ~125). Если код-приватный, выделить его в `src/main/services/productivity/baseline.ts` как exported helper.

---

## 4. Структура страницы

Layout:

- Слева — sticky secondary-nav со списком разделов (anchor scroll).
- Справа — основной контент в одной колонке, ширина ~720px, читабельный line-height.
- Никаких новых тем/токенов: используем существующие CSS-переменные `--color-fg`, `--color-muted-fg`, `--color-chart-1..4`, `--color-border`.

Разделы (по порядку, anchor-id в скобках):

### 4.1. `#intro` — Зачем эта метрика
Один абзац: измерить, становится ли AI-агент эффективнее по мере того как пользователь меняет экосистему (плагины, MCP, скиллы, prompts). Eff — это «сколько токенов вы тратите относительно ожидаемого для задачи такой же сложности».

### 4.2. `#data-sources` — Источники данных
Три карточки:

1. **Транскрипты Claude Code** (`~/.claude/projects/**/*.jsonl`) — источник истины для токенов, тулз, файлов и скиллов. Парсер `src/main/services/productivity/transcript.ts`.
2. **JSONL-буфер хуков** (`~/agent-analytics/sessions/<id>.jsonl`) — лайфцикл сессий (start/end), оценка (score) и summary через `/done`. Парсер `src/main/services/productivity/jsonl.ts`.
3. **Watcher экосистемы** — диффит `~/.claude/settings.json` (enabledPlugins), `~/.claude.json` (mcpServers / mcpServersDisabled), mtimes файлов в `~/.claude/skills/` относительно сохранённого snapshot. Источник: `src/main/services/productivity/infra.ts`.

Текст: что является источником истины, а что — производным. Транскрипты выигрывают любой конфликт.

### 4.3. `#storage` — Что мы храним
Таблицы (drizzle/SQLite, `~/Library/Application Support/atlas-os/atlas.db`):

| Таблица | Гранулярность | Ключевые поля | Источник |
|---|---|---|---|
| `agent_turns` | один turn агента | `sessionId`, `ts`, `tokensIn`, `tokensOut`, `toolsUsed[]`, `skillsUsed[]`, `filesTouched[]` | транскрипт |
| `agent_sessions` | одна сессия | `score 1-10`, `difficulty 1-10`, `totalTokensIn/Out`, `turnCount`, `distinctFiles`, `distinctDirs`, `distinctTools`, `distinctSkills`, `subagentCount` | агрегат + хуки + manual |
| `ecosystem_changes` | одно изменение | `ts`, `type`, `target`, `diff` | watcher / manual |
| `kpi_baseline` | один frozen fit per scope | `method`, `params` (JSON), `periodStart/End`, `sessionCount` | derived |

Phrasing про идемпотентность ingest: id транскрипт-turn-ов детерминирован, повторный парсинг растущего файла безопасен.

### 4.4. `#baseline` — Baseline-модель
Подразделы:

**(a) Постановка задачи.** Прямое сравнение «токенов на сессию» бесполезно — токены растут с объёмом задачи. Нужна модель ожидаемого расхода `E[tokens | task]`, и Eff = ожидаемое/фактическое.

**(b) Выбор предикторов.**
- Использованы: `files` = distinct files touched, `dirs` = distinct dirs touched.
- НЕ используются: turns, tools used, skills used — это эндогенные предикторы (поведение агента). Нормализация по ним стёрла бы тот сигнал, который мы хотим измерять.
- НЕ используется: `difficulty` (1–10) — оставлен только как описательное поле сессии. Раньше использовался в loglinear по difficulty, но покрытие <5% сессий делало модель degenerate.
- Эмпирическое обоснование: `files + dirs` объясняют ≈73% дисперсии `log(tokens)` на baseline-периоде (см. memory `kpd-metric-redesign`).

**(c) Формула регрессии.**

$$\log(\text{expected}_i) = a + b_{\text{files}} \cdot \log(1 + \text{files}_i) + b_{\text{dirs}} \cdot \log(1 + \text{dirs}_i)$$

OLS на 3×3 нормальных уравнениях (Gauss-Jordan), реализация — `ols2` в `src/shared/kpi.ts`. Решение запрещено при сингулярной матрице (нулевая вариация предикторов / коллинеарность) — в этом случае срабатывает fallback.

**(d) Заморозка baseline.**

- Кандидаты: первые `n* = max(15, ⌈0.25 · n⌉)` сессий скоупа, отсортированные по `lastTs` возрастанию (`selectBaselineSamples`).
- Требуется `n* ≥ 8` для scope-метода, иначе fallback.
- После заморозки коэффициенты НЕ обновляются автоматически. Перезапись только через явный `rebaseline` пользователем (UI: project filter dropdown → «Rebaseline»).
- Auto-upgrade: если baseline в БД сейчас `global-median`, но новых данных достаточно для `scope` — заморозим scope-вариант поверх. Регрессия → median сама не «деградирует» (защита от шумных перефитов на тонких данных).

**(e) Fallback `global-median`.**

$$\text{expected} = \text{median}(\text{tokens}_i \mid i \in \text{baseline period})$$

Скоуп игнорируется. Используется в первые дни проекта (n < 8 или нет вариации scope) и для сессий без записанной scope-информации.

**(f) Актуальная модель — LIVE.**

Карточка с реальными числами из `kpiDiagnostics`:
- Метод: `scope` / `global-median`
- Скоуп: `__global__` / `<projectPath>`
- Период заморозки: `periodStart … periodEnd`
- Кол-во сессий в фите: `sessionCount`
- Коэффициенты: `a`, `bFiles`, `bDirs`, `median` (что есть)
- Дата заморозки: `createdAt`

### 4.5. `#per-session` — Per-session Eff

$$\text{Eff}_i = \frac{\text{expected}_i}{\text{actual}_i} \times 100\%$$

Min-work floor:

$$\text{Eff}_i = \text{null}, \quad \text{если}\ \text{actual}_i < \frac{1}{3} \cdot \text{expected}_i$$

Обоснование floor:
- Без floor одна 17-токенная сессия даёт Eff ≈ 1.2 млн% — выбрасывает шкалу графика.
- Фракционный floor (не абсолютный) адаптируется под скоуп и сложность через `expected`.
- Floor бьёт потолок в `1 / (1/3) × 100% = 300%` — все per-session значения отображаются в `[0, 300]`.
- Trade-off: ~½ всех сессий имеют `actual < expected/3` и отбрасываются с графика Eff (но остаются в `tokens per day`).

Edge cases:
- `expected ≤ 0` или `actual ≤ 0` → null
- сессия без `files`/`dirs` → expected подсчитывается по сохранённому `median` (fallback внутри scope-модели)

Код: `sessionKpd` в `src/shared/kpi.ts`.

### 4.6. `#daily` — Дневной Eff и сглаживание

Дневная агрегация **токен-взвешенная** (не среднее по сессиям):

$$\text{Eff}_d = \frac{\sum_{i \in d} \text{expected}_i}{\sum_{i \in d} \text{actual}_i} \times 100\%$$

Обоснование (vs наивное среднее ratio):
- Per-session Eff — это ratio с маленьким знаменателем. Несколько микросессий могут дать `mean(Effᵢ)` = 800–58 000% на реальных данных.
- Токен-взвешивание делает вклад микросессии пропорциональным её размеру: 17-токенная сессия добавляет 17 в знаменатель и `expected(17)` в числитель.
- Проверено на реальной БД: 2026-05-03 58 240%→92%, 2026-05-22 13 493%→41% (из memory `kpd-metric-redesign`).

Сглаживание (главная линия графика):

$$\text{EffSmooth}_d = \text{median}(\text{Eff}_{d-6 \dots d})$$

7-day **trailing** median. Окно усекается у начала истории. Сырая дневная линия рисуется тонкой/полупрозрачной фоном, smooth — главная.

Обоснование: при фиксированном scope per-task token cost варьируется ≈×2.5 (irreducible noise — модель thinking, cache, разная глубина рассуждений). Сырая дневная линия слишком шумная; trailing median (а не центрированный) сохраняет каузальность — сегодняшняя точка не зависит от будущего.

Код: `kpdByDay`, `rollingMedian` в `src/shared/kpi.ts`. На графике (`src/renderer/src/pages/Productivity.tsx`): `dataKey="kpi"` — сырая (faint), `dataKey="kpiSmooth"` — smooth.

### 4.7. `#reliability` — Надёжность

**(a) Goodness-of-fit, LIVE:**
- `R² (in-sample, log scale)` — из `kpiDiagnostics.fit.r2LogScale`. Поясняем, что это R² на обучающем периоде, не predictive.
- `Median |residual| / expected × 100%` — типичная ошибка в линейном масштабе.

**(b) Покрытие данных, LIVE:**
- Сколько сессий с записанным `score` (квалификатор guardrail-линии).
- Сколько сессий с `difficulty` (не используется в Eff, информативно).
- Сколько сессий с непустым `files+dirs` (иначе fallback на median).

**(c) Irreducible noise.** Источники, которые мы не контролируем и не моделируем:
- Cache reads/writes — Eff считает суммарные `tokensIn + tokensOut`, кэш-хиты не различаются. Холодный/горячий старт даёт ×2 разницу при одинаковом scope.
- Extended thinking — токены thinking входят в `tokensOut`. Сессии с thinking более «дорогие» при том же scope.
- Autocompact — длинная сессия может включать autocompact, который мы не различаем в транскрипте.
- Разные модели (Opus/Sonnet/Haiku) — модель сессии в схеме `agent_sessions` сейчас не сохраняется (см. `src/main/db/schema.ts`), Eff трактует все сессии однородно. Сессия на Haiku и сессия на Opus с одинаковым scope считаются взаимозаменяемыми, что неверно по факту.

**(d) Что НЕ входит в расчёт Eff:**
- `cacheReadTokens` / `cacheCreationTokens` — есть только в `benchmark_runs`, не в `agent_turns`.
- `durationMs` / latency.
- `score` (1–10) — отдельная guardrail-линия рядом, не мультипликатор.
- ошибки агента / прерывания.

### 4.8. `#out-of-scope` — Что мы НЕ измеряем
Honest section на полстраницы:

- **Качество вывода.** Eff не знает, был ли результат правильным. Для этого есть отдельная линия `quality` (mean `score` 1–10 за день, только rated сессии).
- **Стоимость в долларах.** Атlas хранит `total_cost_usd` только для бенчмарка, не для агентских сессий.
- **Latency / human-time.** Время сессии не учитывается. Сессия 5 минут и 5 часов с одинаковыми токенами имеют одинаковый Eff.
- **Side-effects.** Eff не знает, сломал ли агент CI, прошли ли тесты, был ли rollback.
- **Cross-task transfer.** Eff усреднён по типам задач; типовой Slack-вопрос и месячный рефакторинг идут в одну корзину (если scope похож).

### 4.9. `#caveats` — Известные ограничения

- **Эндогенность.** Установка нового скилла может ↓ tokens не потому что агент стал эффективнее, а потому что задачи стали проще / агент стал предпочитать короткие решения. Eff не различает «стал умнее» и «стал отговариваться». Бенчмарк-сьют — отдельная exogenous проверка (ссылка на `coming soon` секцию).
- **Замороженный baseline стареет.** Атlas не обновляет baseline автоматически. Если задачи за пол года систематически выросли по сложности, Eff будет дрейфовать вверх не из-за эффективности, а из-за выхода за пределы обучающего распределения. Реcommendация: rebaseline раз в N месяцев или при крупных изменениях характера работы.
- **Сезонность.** День недели / время суток в модели не учитываются.
- **Small-sample tail.** Per-session floor отбрасывает половину сессий из Eff-графика. Не баг: эти сессии слишком короткие, чтобы дать осмысленный ratio.
- **Difficulty.** Поле существует, но в формуле сейчас не участвует. Историческая причина — низкое покрытие.

### 4.10. `#data-inventory` — Полная инвентаризация данных, LIVE
Карточка из `kpiDiagnostics.dataInventory`:

- Всего сессий / турнов / токенов (in / out).
- Период данных: earliest … latest.
- Сессий с scope (`files+dirs > 0`).
- Сессий с user score.
- Сессий с difficulty.
- Ecosystem changes total.

### 4.11. `#code-refs` — Ссылки на код
Конкретные пути с описаниями:

- `src/shared/kpi.ts` — чистая математика (fitBaseline, expectedTokens, sessionKpd, kpdByDay, rollingMedian).
- `src/main/services/productivity/baseline.ts` — заморозка, активный baseline, rebaseline.
- `src/main/services/productivity/transcript.ts` — парсинг транскриптов.
- `src/main/services/productivity/jsonl.ts` — парсинг хуков.
- `src/main/services/productivity/infra.ts` — watcher экосистемы.
- `src/main/trpc/routers/productivity.ts` — `kpi`, `kpiDiagnostics`, `ecosystemImpact`.

### 4.12. Заглушки для остальных графиков
В конце страницы — секция `coming soon` со списком будущих разделов (без содержимого):

- Tokens per day
- Today by hour
- Benchmark suite (independent exogenous check)

---

## 5. Зависимости и инфраструктура

**Новые зависимости** (renderer):

- `katex` (~280 KB unpacked, ~30 KB gzip)
- `react-katex` (1 KB wrapper)

Установка через `pnpm add katex react-katex` + `pnpm add -D @types/react-katex`. KaTeX CSS импортируется в `src/renderer/src/index.css`: `@import 'katex/dist/katex.min.css';`.

Шрифты KaTeX (~250 KB всего) bundling'ятся в Electron app — не критично, у нас уже есть Recharts.

**Никаких миграций БД, никаких изменений существующих схем или формул.**

---

## 6. Компоненты renderer

```
src/renderer/src/pages/Info.tsx                  — главный компонент страницы, layout + secondary nav
src/renderer/src/pages/info/
  ├── Section.tsx                                — <section id={anchor}> wrapper, заголовок
  ├── Formula.tsx                                — react-katex inline/block wrapper, дефолтные опции
  ├── DataCard.tsx                               — карточка с key-value (переиспользует `.kv` стили)
  ├── intro.tsx                                  — §4.1
  ├── data-sources.tsx                           — §4.2
  ├── storage.tsx                                — §4.3
  ├── baseline.tsx                               — §4.4 (использует useQuery → kpiDiagnostics)
  ├── per-session.tsx                            — §4.5
  ├── daily.tsx                                  — §4.6
  ├── reliability.tsx                            — §4.7 (использует useQuery → kpiDiagnostics)
  ├── out-of-scope.tsx                           — §4.8
  ├── caveats.tsx                                — §4.9
  ├── data-inventory.tsx                         — §4.10 (использует useQuery → kpiDiagnostics)
  ├── code-refs.tsx                              — §4.11
  └── coming-soon.tsx                            — §4.12
```

Каждый раздел — самостоятельный компонент 50–150 строк JSX + текст. Дробление сознательное: дальше будет легко вырезать раздел в отдельный popover или переиспользовать карточки.

---

## 7. Тестирование

**Unit:**
- `src/shared/kpi.test.ts` — добавить тесты на новые функции `r2LogScale`, `medianAbsResidualPct`. Известные кейсы: точный фит → R² = 1; median-метод → R² null; пустой массив → null.
- `src/main/services/productivity/baseline.test.ts` — расширить если приватный селектор вынесен в helper.

**Integration:**
- Через `vitest` + drizzle in-memory, проверить, что `kpiDiagnostics` отдаёт baseline для тестового скоупа и совпадает с тем, что используется в `kpi`.

**Manual UAT (до презентации):**
- Открыть Info → видна актуальная модель, R², период.
- Все формулы рендерятся KaTeX без layout shift.
- Secondary nav скроллит к якорю при клике, активный раздел подсвечивается при скролле.
- На пустой БД (`baseline = null`) страница не падает, показывает «модель ещё не зафиксирована».
- Все ссылки на исходники (§4.11) — actual paths, проверяем `find`'ом.

---

## 8. Out of scope (на этой итерации)

- Контент для tokens-per-day, today-by-hour, benchmark разделов — только заглушки.
- Переработка popover `?` у графика token efficiency — остаётся короткая выжимка.
- Scatter plot actual vs expected (опциональная фича из §4 design talk) — не делаем, оставим как кандидат на следующую итерацию.
- Анимации, переходы между разделами, поиск по странице.
- Английская версия — UI остальной части app остаётся английским, info-страница на русском (сознательное исключение).

---

## 9. Acceptance

Готово, когда:

1. Сайдбар показывает 6 пунктов, `04 · INFO` открывается, остальные сдвинуты, Cmd+1..6 работают.
2. Все 12 разделов отрендерены, формулы KaTeX визуально корректны, не плывут.
3. Карточки §4.4(f), §4.7(a-b), §4.10 показывают актуальные числа из БД через `kpiDiagnostics`.
4. На пустой БД страница загружается без ошибок и явно сообщает «baseline не зафиксирован».
5. Unit-тесты `r2LogScale`, `medianAbsResidualPct` зелёные.
6. `pnpm typecheck` зелёный, `pnpm lint` без новых warning'ов.
7. `pnpm dev` запускается, страница открывается, формулы видны, числа подтянуты.
