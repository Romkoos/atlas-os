import { homedir } from 'node:os'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { claudeSdkExecutableOption } from '@main/paths'
// Private-subscription env (CLAUDE_CONFIG_DIR=~/.claude-private + stripped API keys).
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'

export interface ClaudeResult {
  text: string
  outputTokens: number
}

export interface ClaudeRun {
  done: Promise<ClaudeResult>
  cancel: () => void
}

export interface RunClaudeOptions {
  prompt: string
  model: string
  onToken: (text: string) => void
}

export function runClaude(opts: RunClaudeOptions): ClaudeRun {
  const controller = new AbortController()
  let queryRef: Query | null = null

  const done = (async (): Promise<ClaudeResult> => {
    // ESM-only SDK loaded via dynamic import from the CJS main bundle.
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const q = query({
      prompt: opts.prompt,
      options: {
        model: opts.model,
        includePartialMessages: true,
        allowedTools: [], // pure text generation — no tools, no permission prompts
        settingSources: [], // ignore user/project CLAUDE.md, MCP, skills
        cwd: homedir(),
        env: subscriptionEnv(),
        abortController: controller,
        ...claudeSdkExecutableOption(),
      },
    })
    queryRef = q

    let streamed = ''
    let finalText = ''
    let outputTokens = 0

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          streamed += event.delta.text
          opts.onToken(event.delta.text)
        }
      } else if (message.type === 'result') {
        outputTokens = message.usage.output_tokens ?? 0
        if (message.subtype === 'success') {
          finalText = message.result
        } else {
          const reason = message.errors?.join('; ') || message.subtype
          throw new Error(`Claude run failed: ${reason}`)
        }
      }
    }

    return { text: finalText || streamed, outputTokens }
  })()

  return {
    done,
    cancel: () => {
      controller.abort()
      queryRef?.interrupt().catch(() => {})
    },
  }
}
