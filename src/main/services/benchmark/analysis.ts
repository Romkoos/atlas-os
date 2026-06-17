import type { AbRow } from '@main/services/benchmark/aggregate'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'

const TIMEOUT_MS = 2 * 60_000

function fmtPct(pct: number): string {
  if (Number.isNaN(pct)) return 'n/a'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

// Render the A/B slice as a compact table and ask for a short plain-language
// read of what the infra change did. Kept pure so it is unit-testable.
export function buildAnalysisPrompt(slice: AbRow[]): string {
  const lines = slice.map(
    (r) =>
      `- ${r.taskId}: total tokens ${fmtPct(r.tokens.pctDelta)} (${Math.round(r.tokens.before)} → ${Math.round(r.tokens.after)}), output ${fmtPct(r.output.pctDelta)}, cost ${fmtPct(r.cost.pctDelta)}`,
  )
  return [
    'You are analyzing an A/B benchmark of a Claude Code "infra" change (CLAUDE.md, MCP servers, skills).',
    'Each line compares the latest infra variant (after) against the previous one (before) for one fixed task. Negative percentages mean the new infra is cheaper/smaller; positive means more expensive.',
    '',
    'Per-task deltas:',
    ...lines,
    '',
    'In 2-3 sentences of plain language, explain the overall effect of this infra change: did it make tasks cheaper, more expensive, or mixed, and where the biggest shifts are. Do not list every task; summarize. Output only the sentences, no preamble.',
  ].join('\n')
}

// One-shot, single-turn, NO tools. Returns the model's text, or null on failure
// (timeout / non-success / empty). Never throws — the caller persists null.
export async function runAnalysis(opts: {
  slice: AbRow[]
  model: string
  repoRoot: string
  timeoutMs?: number
}): Promise<string | null> {
  if (opts.slice.length === 0) return null
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS)
  let text = ''
  try {
    const q = query({
      prompt: buildAnalysisPrompt(opts.slice),
      options: {
        model: opts.model,
        allowedTools: [],
        permissionMode: 'bypassPermissions' as const,
        settingSources: [] as ('user' | 'project')[],
        cwd: opts.repoRoot,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    for await (const message of q) {
      if (message.type === 'result' && message.subtype === 'success') {
        text = message.result
      }
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}
