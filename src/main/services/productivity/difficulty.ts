import { homedir } from 'node:os'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

const RUBRIC = `You rate the intrinsic difficulty of a software task from the FIRST user request only.
Rate 1–10 based on what was ASKED, not how it was done.
1–2 trivial (typo, rename). 3–4 small (one function/file). 5–6 moderate (feature across a few files).
7–8 hard (cross-cutting change, tricky logic). 9–10 very hard (architecture, deep debugging, research).
Reply with ONLY the integer.`

// Hard ceiling so a stuck request never blocks the productivity pipeline.
const TIMEOUT_MS = 30_000

// Subscription-only: strip any metered API key so the bundled Claude Code falls
// back to the user's Pro/Max OAuth login (~/.claude). Mirrors claude.ts.
function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

// Pull the integer 1–10 out of arbitrary assistant text.
function parseRating(text: string): number | null {
  const match = text.match(/\b(10|[1-9])\b/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null
}

/**
 * Estimate intrinsic task difficulty (1–10) from the first user prompt.
 *
 * Isolated and failure-tolerant: any error, timeout, or unparseable output
 * resolves to `null`. This function NEVER throws.
 */
export async function estimateDifficulty(firstPrompt: string): Promise<number | null> {
  const text = firstPrompt.trim().slice(0, 4000)
  if (!text) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    // ESM-only SDK loaded via dynamic import from the CJS main bundle.
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const q = query({
      prompt: `${RUBRIC}\n\n---\nTASK REQUEST:\n${text}`,
      options: {
        maxTurns: 1,
        allowedTools: [], // pure text rating — no tools, no permission prompts
        settingSources: [], // ignore user/project CLAUDE.md, MCP, skills
        cwd: homedir(),
        env: subscriptionEnv(),
        abortController: controller,
      },
    })

    let out = ''
    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'text') out += block.text
        }
      } else if (message.type === 'result' && message.subtype === 'success') {
        out += message.result
      }
    }

    return parseRating(out)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
