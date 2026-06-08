import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { storeRoot } from '@main/services/knowledge/store'

export interface NewsRun {
  done: Promise<{ filePath: string; outputTokens: number }>
  cancel: () => void
}

export interface RunNewsOptions {
  model: string
  onToken: (text: string) => void
}

// Tools the daily-ai-news skill needs end-to-end: invoke the skill, search/fetch
// the web, get the date via Bash, and write the digest file itself. With an
// explicit allowlist the SDK exposes exactly these — nothing the skill can't use.
const NEWS_TOOLS = ['Skill', 'WebSearch', 'WebFetch', 'Read', 'Write', 'Bash', 'Glob', 'TodoWrite']

const NEWS_PROMPT =
  'Run the daily-ai-news skill and compile a digest of AI news from the last 24 hours. ' +
  'Save the result to a single file (overwriting it), as described in the skill.'

// The news folder lives at the store root alongside per-project dirs. It is
// deliberately NOT a knowledge project (no `knowledge/` subfolder) and is also
// excluded from the Knowledge page (see knowledge/store EXCLUDED).
export function newsDir(): string {
  return join(storeRoot(), 'news')
}

export function newsFilePath(): string {
  return join(newsDir(), 'ai-news.md')
}

// Read the single overwritten digest. Absent file → empty raw + null mtime so the
// UI can show its empty state without throwing.
export function readNews(): { raw: string; updatedAt: string | null } {
  const file = newsFilePath()
  if (!existsSync(file)) return { raw: '', updatedAt: null }
  return { raw: readFileSync(file, 'utf8'), updatedAt: statSync(file).mtime.toISOString() }
}

// Subscription-only: strip metered API keys so the spawned CLI uses the user's
// Pro/Max OAuth (mirrors claude.ts / benchmark/runner.ts).
function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

// Run the daily-ai-news skill headlessly, streaming the model's text output. The
// skill owns the file write; `done` resolves with the path once the run succeeds.
export function runNews(opts: RunNewsOptions): NewsRun {
  const controller = new AbortController()
  let queryRef: Query | null = null

  const done = (async (): Promise<{ filePath: string; outputTokens: number }> => {
    // Ensure the target dir exists up front; the skill's Write also creates it,
    // but this guarantees a stable path even if the skill changes.
    mkdirSync(newsDir(), { recursive: true })

    // ESM-only SDK loaded via dynamic import from the CJS main bundle.
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const q = query({
      prompt: NEWS_PROMPT,
      options: {
        model: opts.model,
        settingSources: ['user'], // load ~/.claude/skills so daily-ai-news is available
        allowedTools: NEWS_TOOLS,
        permissionMode: 'bypassPermissions', // headless: never hang on a prompt
        includePartialMessages: true,
        cwd: homedir(),
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    queryRef = q

    // Track the streaming block type so we can drop a newline after each finished
    // text block — otherwise separate status messages concatenate into one line.
    let blockType: string | null = null
    let outputTokens = 0

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_start') {
          blockType = event.content_block.type
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          opts.onToken(event.delta.text)
        } else if (event.type === 'content_block_stop') {
          if (blockType === 'text') opts.onToken('\n')
          blockType = null
        }
      } else if (message.type === 'result') {
        outputTokens = message.usage.output_tokens ?? 0
        if (message.subtype !== 'success') {
          const reason = message.errors?.join('; ') || message.subtype
          throw new Error(`News run failed: ${reason}`)
        }
      }
    }

    return { filePath: newsFilePath(), outputTokens }
  })()

  return {
    done,
    cancel: () => {
      controller.abort()
      queryRef?.interrupt().catch(() => {})
    },
  }
}
