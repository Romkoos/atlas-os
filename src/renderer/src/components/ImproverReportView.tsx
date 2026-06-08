import type { ImproverReport } from '@shared/skillImprover'

function pct(v: number | undefined): string {
  return v === undefined ? '—' : `${Math.round(v * 100)}%`
}
function num(v: number | undefined): string {
  return v === undefined ? '—' : v.toLocaleString('en-US')
}
function secs(v: number | undefined): string {
  return v === undefined ? '—' : `${(v / 1000).toFixed(1)}s`
}

const cell = { padding: '4px 10px', borderBottom: '1px solid var(--line-dim)' } as const
const th = { ...cell, color: 'var(--fg-4)', textAlign: 'left' as const, fontWeight: 400 }

// Native render of the final A/B report: per-version benchmark table, per-eval
// breakdown, before/after description, and the analyst's prose summary.
export function ImproverReportView({ report }: { report: ImproverReport }) {
  const evalNames = [
    ...new Set(report.iterations.flatMap((it) => (it.perEval ?? []).map((e) => e.name))),
  ]

  function label(n: number): string {
    return n === 0 ? 'baseline' : `iter ${n}`
  }

  return (
    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--fg-2)' }}>
      <div
        style={{
          color: 'var(--fg-4)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: 11,
          marginBottom: 8,
        }}
      >
        A/B report · {report.skillName}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
        <thead>
          <tr>
            <th style={th}>version</th>
            <th style={th}>pass rate</th>
            <th style={th}>tokens</th>
            <th style={th}>time</th>
          </tr>
        </thead>
        <tbody>
          {report.iterations.map((it) => (
            <tr key={it.n}>
              <td style={{ ...cell, color: it.n === 0 ? 'var(--fg-4)' : 'var(--amber)' }}>
                {label(it.n)}
              </td>
              <td style={cell}>{pct(it.passRate)}</td>
              <td style={cell}>{num(it.tokens)}</td>
              <td style={cell}>{secs(it.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {evalNames.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={th}>eval</th>
              {report.iterations.map((it) => (
                <th key={it.n} style={th}>
                  {label(it.n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {evalNames.map((name) => (
              <tr key={name}>
                <td style={cell}>{name}</td>
                {report.iterations.map((it) => {
                  const e = (it.perEval ?? []).find((x) => x.name === name)
                  return (
                    <td key={it.n} style={cell} title={e?.notes ?? ''}>
                      {e === undefined ? '—' : e.passed ? '✓' : '✗'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {report.beforeDescription || report.afterDescription ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--fg-4)', marginBottom: 4 }}>description</div>
          {report.beforeDescription ? (
            <div style={{ color: 'var(--fg-4)', textDecoration: 'line-through', marginBottom: 4 }}>
              {report.beforeDescription}
            </div>
          ) : null}
          {report.afterDescription ? (
            <div style={{ color: 'var(--amber)' }}>{report.afterDescription}</div>
          ) : null}
        </div>
      ) : null}

      {report.diffSummary ? (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--fg-4)', marginBottom: 4 }}>changes</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{report.diffSummary}</div>
        </div>
      ) : null}

      {report.analystSummary ? (
        <div>
          <div style={{ color: 'var(--fg-4)', marginBottom: 4 }}>analysis</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{report.analystSummary}</div>
        </div>
      ) : null}
    </div>
  )
}
