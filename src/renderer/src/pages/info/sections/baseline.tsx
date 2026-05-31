import { trpc } from '@renderer/lib/trpc'
import { formatDate as fmtDate } from '@renderer/lib/utils'
import { DataCard } from '@renderer/pages/info/DataCard'
import { Formula } from '@renderer/pages/info/Formula'
import { Section } from '@renderer/pages/info/Section'

const fmtNum = (n: number | undefined, digits = 4): string => (n == null ? '—' : n.toFixed(digits))

export function Baseline() {
  const q = trpc.productivity.kpiDiagnostics.useQuery()
  const b = q.data?.baseline ?? null

  return (
    <Section id="baseline" title="4. Бейзлайн: модель ожидаемого">
      <h4 className="mt-12">(а) Постановка задачи</h4>
      <p>
        Прямое сравнение «токенов на сессию» бесполезно — токены растут с объёмом задачи. Нужна
        модель ожидаемого расхода <Formula tex="E[\text{tokens} \mid \text{task}]" />, и тогда Eff =
        ожидаемое / фактическое.
      </p>

      <h4 className="mt-12">(б) Выбор предикторов</h4>
      <ul>
        <li>
          <b>Используются:</b> <code>files</code> — distinct files touched в сессии,{' '}
          <code>dirs</code> — distinct dirs touched.
        </li>
        <li>
          <b>НЕ используются:</b> turns, tools used, skills used. Это эндогенные предикторы
          (поведение агента); нормализация по ним стёрла бы тот сигнал, который мы хотим измерять.
        </li>
        <li>
          <b>НЕ используется difficulty (1–10):</b> оставлено как описательное поле сессии.
          Историческая loglinear по difficulty не работала — покрытие меньше 5% сессий.
        </li>
        <li>
          <b>Эмпирически:</b> <code>files + dirs</code> объясняют ≈73% дисперсии{' '}
          <code>log(tokens)</code> на бейзлайн-периоде.
        </li>
      </ul>

      <h4 className="mt-12">(в) Формула регрессии</h4>
      <Formula
        display
        tex={String.raw`\log(\text{expected}_i) = a + b_{\text{files}} \cdot \log(1 + \text{files}_i) + b_{\text{dirs}} \cdot \log(1 + \text{dirs}_i)`}
      />
      <p>
        Подгонка — OLS на 3×3 нормальных уравнениях (метод Гаусса–Жордана), реализация —{' '}
        <code>ols2</code> в <code>src/shared/kpi.ts</code>. При сингулярной матрице (нулевая
        вариация предикторов или коллинеарность) подгонка отвергается, и срабатывает fallback.
      </p>

      <h4 className="mt-12">(г) Заморозка</h4>
      <ul>
        <li>
          Кандидаты: первые{' '}
          <Formula tex={String.raw`n^* = \max(15,\ \lceil 0.25 \cdot n \rceil)`} /> сессий скоупа,
          отсортированные по <code>lastTs</code> возрастанию.
        </li>
        <li>
          Требуется <Formula tex={String.raw`n^* \geq 8`} /> для scope-метода, иначе fallback.
        </li>
        <li>
          После заморозки коэффициенты НЕ обновляются автоматически. Перезапись — только через явный
          rebaseline.
        </li>
      </ul>

      <h4 className="mt-12">(д) Fallback: глобальная медиана</h4>
      <Formula
        display
        tex={String.raw`\text{expected} = \mathrm{median}(\text{tokens}_i \mid i \in \text{baseline period})`}
      />
      <p>
        Скоуп игнорируется. Используется в первые дни проекта (n &lt; 8 или нет вариации scope) и
        для сессий без записанной информации о scope.
      </p>

      <h4 className="mt-12">(е) Актуальная модель</h4>
      <DataCard
        title="frozen baseline (live)"
        loading={q.isLoading}
        empty={b == null ? 'Бейзлайн ещё не зафиксирован — недостаточно сессий в скоупе.' : null}
        rows={
          b
            ? [
                { label: 'scope', value: <code>{b.scope}</code> },
                { label: 'method', value: <code>{b.method}</code> },
                {
                  label: 'period',
                  value: `${fmtDate(b.periodStart)} … ${fmtDate(b.periodEnd)}`,
                },
                { label: 'sessions used (n*)', value: b.sessionCount },
                { label: 'a (intercept)', value: fmtNum(b.params.a) },
                { label: 'b_files', value: fmtNum(b.params.bFiles) },
                { label: 'b_dirs', value: fmtNum(b.params.bDirs) },
                {
                  label: 'stored median (tokens)',
                  value: b.params.median == null ? '—' : b.params.median.toFixed(0),
                },
                { label: 'frozen at', value: fmtDate(b.createdAt) },
              ]
            : []
        }
      />
    </Section>
  )
}
