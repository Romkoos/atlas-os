// src/main/services/generalChat/run.ts
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@main/logger'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import { createMailbox, type Mailbox } from '@main/services/skillImprover/mailbox'
import type { GeneralChatEvent } from '@shared/ipc-events'

// Read-only tools: the chat may inspect code but must never mutate the repo.
const CHAT_TOOLS = ['Read', 'Grep', 'Glob']

export interface GeneralChatRun {
  reply: (text: string) => void
  cancel: () => void
  done: Promise<void>
}

export interface StartGeneralChatOptions {
  requestId: string
  seed: string
  model: string
  repoRoot: string
  emit: (event: GeneralChatEvent) => void
}

// Interactive general chat session. Streaming-input mode: the session stays open
// across turns until the mailbox is closed by cancel.
export function startGeneralChat(opts: StartGeneralChatOptions): GeneralChatRun {
  const controller = new AbortController()
  let queryRef: Query | null = null
  let mailbox: Mailbox | null = null
  let stopped = false

  const done = (async (): Promise<void> => {
    mailbox = createMailbox(opts.seed)
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt: mailbox.stream,
      options: {
        model: opts.model,
        allowedTools: CHAT_TOOLS,
        permissionMode: 'bypassPermissions',
        settingSources: ['user', 'project'],
        includePartialMessages: true,
        cwd: opts.repoRoot,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    queryRef = q

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          opts.emit({ type: 'token', text: event.delta.text })
        }
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            opts.emit({
              type: 'tool',
              name: block.name,
              summary: summarizeTool(block),
              toolId: block.id,
            })
          }
        }
      } else if (message.type === 'result') {
        if (stopped) continue
        if (message.subtype === 'success') {
          opts.emit({ type: 'awaiting-input' })
        } else {
          const reason = message.errors?.join('; ') || message.subtype
          opts.emit({ type: 'error', message: `Chat run failed: ${reason}` })
        }
      }
    }
  })().catch((error) => {
    if (stopped) return
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('General chat failed', message)
    opts.emit({ type: 'error', message })
  })

  return {
    reply: (text: string) => mailbox?.push(text),
    cancel: () => {
      if (stopped) return
      stopped = true
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      void done.then(() => opts.emit({ type: 'aborted' }))
    },
    done,
  }
}

function summarizeTool(block: { name: string; input: unknown }): string {
  const input = block.input as Record<string, unknown> | undefined
  if (!input) return block.name
  const hint =
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.pattern === 'string' && input.pattern) ||
    (typeof input.command === 'string' && input.command) ||
    ''
  const text = String(hint).slice(0, 80)
  return text ? `${block.name}: ${text}` : block.name
}
