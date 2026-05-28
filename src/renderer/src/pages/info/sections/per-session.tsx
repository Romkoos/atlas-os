import { Formula } from '@renderer/pages/info/Formula'
import { Section } from '@renderer/pages/info/Section'

export function PerSession() {
  return (
    <Section id="per-session" title="5. Per-session Eff">
      <Formula
        display
        tex={String.raw`\mathrm{Eff}_i = \frac{\mathrm{expected}_i}{\mathrm{actual}_i} \times 100\%`}
      />
      <p>
        Min-work floor:{' '}
        <Formula
          tex={String.raw`\mathrm{Eff}_i = \text{null} \quad \text{если}\ \mathrm{actual}_i < \tfrac{1}{3} \cdot \mathrm{expected}_i`}
        />
      </p>
      <h4 className="mt-12">Зачем нужен floor</h4>
      <ul>
        <li>
          Без floor одна 17-токенная сессия даёт Eff ≈ 1 200 000% — это выбрасывает шкалу графика.
        </li>
        <li>
          Floor фракционный, не абсолютный — адаптируется под скоуп и сложность через{' '}
          <code>expected</code>.
        </li>
        <li>
          Floor математически бьёт потолок:{' '}
          <Formula tex={String.raw`\mathrm{Eff}_{\max} = \frac{1}{1/3} \times 100\% = 300\%`} />.
        </li>
        <li>
          Trade-off: ≈½ всех сессий имеют{' '}
          <Formula tex={String.raw`\mathrm{actual} < \mathrm{expected}/3`} /> и отбрасываются с
          графика Eff (но остаются на графике tokens per day).
        </li>
      </ul>
      <h4 className="mt-12">Edge cases</h4>
      <ul>
        <li>
          <code>expected ≤ 0</code> или <code>actual ≤ 0</code> → null
        </li>
        <li>
          сессия без <code>files</code>/<code>dirs</code> → expected подсчитывается по сохранённому
          median (внутренний fallback scope-модели)
        </li>
      </ul>
      <p style={{ color: 'var(--color-muted-fg)' }}>
        Реализация: <code>sessionKpd</code> в <code>src/shared/kpi.ts</code>.
      </p>
    </Section>
  )
}
