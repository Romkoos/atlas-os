import type { AbRow } from '@main/services/benchmark/aggregate'

function fmtPct(pct: number): string {
  if (Number.isNaN(pct)) return 'n/a'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

// The opening user message for the discussion session. Gives the model the
// auto-analysis conclusion plus the underlying A/B table, and tells it the repo
// is available read-only for follow-up digging.
export function buildChatSeed(summary: string | null, slice: AbRow[]): string {
  const table = slice.map(
    (r) =>
      `- ${r.taskId}: total tokens ${fmtPct(r.tokens.pctDelta)} (${Math.round(r.tokens.before)} → ${Math.round(r.tokens.after)}), output ${fmtPct(r.output.pctDelta)}, cost ${fmtPct(r.cost.pctDelta)}`,
  )
  return [
    'We just finished an A/B benchmark of a Claude Code infra change (CLAUDE.md, MCP servers, skills). Each row compares the latest infra variant against the previous one for one fixed task.',
    '',
    summary
      ? `Automated summary: ${summary}`
      : 'There is no automated summary for this run (analysis failed).',
    '',
    'Per-task A/B deltas:',
    ...table,
    '',
    'I want to discuss these results with you. You have read-only access to this repository (Read, Grep, Glob) if you need to inspect code or transcripts to explain a result. Start by briefly confirming you have the data, then ask what I want to dig into.',
  ].join('\n')
}
