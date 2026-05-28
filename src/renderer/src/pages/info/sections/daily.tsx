import { Formula } from '@renderer/pages/info/Formula'
import { Section } from '@renderer/pages/info/Section'

export function Daily() {
  return (
    <Section id="daily" title="6. Дневной Eff и сглаживание">
      <p>
        Дневная агрегация <b>токен-взвешенная</b>, не среднее по сессиям:
      </p>
      <Formula
        display
        tex={String.raw`\mathrm{Eff}_d = \frac{\sum_{i \in d} \mathrm{expected}_i}{\sum_{i \in d} \mathrm{actual}_i} \times 100\%`}
      />
      <h4 className="mt-12">Почему не среднее ratio</h4>
      <ul>
        <li>
          Per-session Eff — это ratio с маленьким знаменателем. Несколько микросессий могут дать{' '}
          <Formula tex={String.raw`\mathrm{mean}(\mathrm{Eff}_i)`} /> = 800–58 000% на реальных
          данных.
        </li>
        <li>
          Токен-взвешивание делает вклад микросессии пропорциональным её размеру: 17-токенная сессия
          добавляет 17 в знаменатель и <code>expected(17)</code> в числитель.
        </li>
        <li>Проверено на реальной БД: 2026-05-03 58 240% → 92%, 2026-05-22 13 493% → 41%.</li>
      </ul>

      <h4 className="mt-12">Сглаживание</h4>
      <p>
        Главная линия графика — 7-day <b>trailing</b> median дневного Eff:
      </p>
      <Formula
        display
        tex={String.raw`\mathrm{EffSmooth}_d = \mathrm{median}\bigl(\mathrm{Eff}_{d-6},\ \ldots,\ \mathrm{Eff}_d\bigr)`}
      />
      <p>
        Окно усекается у начала истории. Сырая дневная линия рисуется тонкой/полупрозрачной фоном,
        smooth — главная. При фиксированном scope per-task token cost варьируется ≈×2.5 (irreducible
        noise — режим thinking, cache, разная глубина рассуждений). Trailing median (а не
        центрированный) сохраняет каузальность: сегодняшняя точка не зависит от будущего.
      </p>
      <p style={{ color: 'var(--color-muted-fg)' }}>
        Реализация: <code>kpdByDay</code>, <code>rollingMedian</code> в{' '}
        <code>src/shared/kpi.ts</code>.
      </p>
    </Section>
  )
}
