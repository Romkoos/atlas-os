import { trpc } from '@renderer/lib/trpc'
import { useBenchmarkChatContext } from '@renderer/store/benchmarkChatRun'
import { skipToken } from '@tanstack/react-query'

// The batch this discussion is about. There is no single "getBatch" procedure —
// `progress` is the real batchId-scoped fetch (run counts/phase, in-memory so it
// goes null after an app restart) and `latestAnalysis` is the most recent A/B
// analysis row *overall* (not batch-filtered), so we only show it when its
// `batchId` happens to match the attached batch. See src/main/trpc/routers/benchmark.ts.
export function ResultsCanvas() {
  const batchId = useBenchmarkChatContext((s) => s.batchId)
  const progress = trpc.benchmark.progress.useQuery(batchId ? { batchId } : skipToken)
  const analysis = trpc.benchmark.latestAnalysis.useQuery()

  if (!batchId) return <div className="canvas-empty">No batch attached.</div>
  if (progress.isLoading) return <div className="canvas-empty">Loading results…</div>
  if (analysis.isLoading) return <div className="canvas-empty">Loading…</div>

  const prog = progress.data
  const rows = analysis.data?.batchId === batchId ? (analysis.data?.dataJson ?? []) : []

  return (
    <div className="canvas-list">
      <div className="canvas-h">
        batch · {prog ? `${prog.done}/${prog.total} runs` : '—'}
        {prog?.failed ? ` · ${prog.failed} failed` : ''}
        {prog ? ` · ${prog.phase}` : ' · no live progress (may predate app restart)'}
      </div>
      {rows.length === 0 ? (
        <div className="canvas-empty">No A/B analysis for this batch yet.</div>
      ) : (
        <table className="canvas-table">
          <thead>
            <tr>
              <th>task</th>
              <th>tokens Δ</th>
              <th>output Δ</th>
              <th>cost Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.taskId}>
                <td>{r.taskId}</td>
                <td>{r.tokens ? `${r.tokens.pctDelta.toFixed(1)}%` : '—'}</td>
                <td>{r.output ? `${r.output.pctDelta.toFixed(1)}%` : '—'}</td>
                <td>{r.cost ? `${r.cost.pctDelta.toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
