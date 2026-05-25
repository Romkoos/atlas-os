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

  let resultText = ''
  let tokensIn = 0
  let tokensOut = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  let totalCostUsd = 0
  let numTurns = 0
  let durationMs = 0
  let subtype = 'error'
  let sessionId: string | null = null

  try {
    const q = query({
      prompt: task.prompt,
      options: {
        model: opts.model,
        settingSources: ['user', 'project'], // LOAD infra under test — opposite of difficulty.ts
        allowedTools: ['Read', 'Grep', 'Glob'], // read-only — live repo cannot mutate
        permissionMode: 'bypassPermissions', // headless: never hang on a prompt
        cwd: opts.repoRoot,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    for await (const message of q) {
      if (message.type === 'result') {
        subtype = message.subtype
        numTurns = message.num_turns
        durationMs = message.duration_ms
        sessionId = message.session_id
        if (message.subtype === 'success') {
          resultText = message.result
          totalCostUsd = message.total_cost_usd
          tokensIn = message.usage.input_tokens ?? 0
          tokensOut = message.usage.output_tokens ?? 0
          cacheReadTokens = message.usage.cache_read_input_tokens ?? 0
          cacheCreationTokens = message.usage.cache_creation_input_tokens ?? 0
        }
      }
    }
  } catch {
    // swallow — gate below classifies via the aborted flag / non-success subtype
  } finally {
    clearTimeout(timer)
  }

  const gate = checkRun({ subtype, resultText, aborted: controller.signal.aborted }, task.assert)
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
  }
}

export function repoCommit(repoRoot: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }).toString().trim()
  } catch {
    return 'unknown'
  }
}
