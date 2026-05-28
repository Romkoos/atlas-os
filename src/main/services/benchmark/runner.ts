// src/main/services/benchmark/runner.ts
import { execFileSync } from 'node:child_process'
import { checkRun } from '@main/services/benchmark/gate'
import type { BenchmarkTask, RunResult } from '@main/services/benchmark/types'

const TIMEOUT_MS = 5 * 60_000

// Mirror difficulty.ts: force the user's Pro/Max OAuth by stripping API keys.
function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

export interface RunOptions {
  model: string
  repoRoot: string
  timeoutMs?: number
}

export async function runBenchmarkTask(task: BenchmarkTask, opts: RunOptions): Promise<RunResult> {
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS)

  // Aggregate metrics across ALL turns of the session, so the totals reflect the
  // amortized cost of a multi-turn conversation (prefix created on turn 1, read
  // on turns 2+). Single-turn tasks behave identically to before.
  let finalResult = ''
  let tokensIn = 0
  let tokensOut = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let totalCostUsd = 0
  let numTurns = 0
  let durationMs = 0
  let finalSubtype = 'error'
  let sessionId: string | null = null

  const turns = [task.prompt, ...(task.followUps ?? [])]
  const baseOptions = {
    model: opts.model,
    settingSources: ['user', 'project'] as ('user' | 'project')[], // LOAD infra under test — opposite of difficulty.ts
    // Default: read-only tools so the live repo cannot mutate. A task can widen
    // this set (e.g. add 'Bash' for read-only git inspection) via allowedTools.
    allowedTools: task.allowedTools ?? ['Read', 'Grep', 'Glob'],
    permissionMode: 'bypassPermissions' as const, // headless: never hang on a prompt
    cwd: opts.repoRoot,
    env: subscriptionEnv(),
    abortController: controller,
  }

  try {
    for (let i = 0; i < turns.length; i++) {
      // First turn opens a fresh session; subsequent turns RESUME it via the
      // session_id captured from the previous turn's result, so cache-control
      // breakpoints are shared and the prefix becomes a cache_read hit.
      const q = query({
        prompt: turns[i],
        options: sessionId == null ? baseOptions : { ...baseOptions, resume: sessionId },
      })
      let turnSubtype = 'error'
      let turnSucceeded = false
      for await (const message of q) {
        if (message.type === 'result') {
          turnSubtype = message.subtype
          finalSubtype = message.subtype
          numTurns += message.num_turns
          durationMs += message.duration_ms
          sessionId = message.session_id
          if (message.subtype === 'success') {
            turnSucceeded = true
            finalResult = message.result
            totalCostUsd += message.total_cost_usd
            tokensIn += message.usage.input_tokens ?? 0
            tokensOut += message.usage.output_tokens ?? 0
            cacheReadTokens += message.usage.cache_read_input_tokens ?? 0
            cacheCreationTokens += message.usage.cache_creation_input_tokens ?? 0
          }
        }
      }
      // Stop the scenario on the first failed turn — no point measuring the
      // tail; gate will classify on the final state.
      if (!turnSucceeded) {
        finalSubtype = turnSubtype
        break
      }
    }
  } catch {
    // swallow — gate below classifies via the aborted flag / non-success subtype
  } finally {
    clearTimeout(timer)
  }

  const gate = checkRun(
    {
      subtype: finalSubtype,
      resultText: finalResult,
      aborted: controller.signal.aborted,
      // Zero turns AND zero duration ⇒ the SDK never emitted a result message,
      // so the 5-min wall-clock timer cannot have fired. Treat as sdk_error.
      noProgress: numTurns === 0 && durationMs === 0,
    },
    task.assert,
  )
  return {
    taskId: task.id,
    model: opts.model,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    cacheCreationTokens,
    totalCostUsd,
    numTurns,
    durationMs,
    success: gate.valid,
    failReason: gate.failReason,
    sessionId,
    resultText: finalResult,
  }
}

export function repoCommit(repoRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
  } catch {
    return 'unknown'
  }
}
