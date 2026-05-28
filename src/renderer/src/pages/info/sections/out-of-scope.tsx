import { Section } from '@renderer/pages/info/Section'

export function OutOfScope() {
  return (
    <Section id="out-of-scope" title="8. Что мы НЕ измеряем">
      <ul>
        <li>
          <b>Качество вывода.</b> Eff не знает, был ли результат правильным. Для этого есть
          отдельная линия <code>quality</code> на графике — среднее <code>score</code> 1–10 за день,
          только по rated-сессиям.
        </li>
        <li>
          <b>Стоимость в долларах.</b> Atlas хранит <code>total_cost_usd</code> только для
          бенчмарка, не для агентских сессий.
        </li>
        <li>
          <b>Latency / human-time.</b> Время сессии не учитывается. Сессия 5 минут и 5 часов с
          одинаковыми токенами имеют одинаковый Eff.
        </li>
        <li>
          <b>Side-effects.</b> Eff не знает, сломал ли агент CI, прошли ли тесты, был ли rollback.
        </li>
        <li>
          <b>Cross-task transfer.</b> Eff усреднён по типам задач — типовой Slack-вопрос и месячный
          рефакторинг идут в одну корзину, если scope похож.
        </li>
      </ul>
    </Section>
  )
}
