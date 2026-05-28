import { Section } from '@renderer/pages/info/Section'

export function ComingSoon() {
  return (
    <Section id="coming-soon" title="12. В разработке">
      <p>Другие разделы инфостраницы будут добавлены позже:</p>
      <ul>
        <li>Tokens per day — что и как считаем по токенам в день, источники, надёжность.</li>
        <li>Today by hour — дневной профиль активности.</li>
        <li>
          Benchmark suite — независимая exogenous-проверка эффективности на замороженных задачах,
          параллельно к Token Efficiency.
        </li>
      </ul>
    </Section>
  )
}
