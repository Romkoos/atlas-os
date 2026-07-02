import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@main/logger'
import { createMailbox, type Mailbox } from '@main/services/skillImprover/mailbox'
import type { BaseChatEvent } from '@shared/ipc-events'

export interface ResumableRun {
  reply: (text: string) => void
  cancel: () => void
  done: Promise<void>
}
export type SettingSource = 'user' | 'project' | 'local'

export interface StartResumableChatOptions {
  sessionId: string
  model: string
  cwd: string
  allowedTools: string[]
  settingSources: SettingSource[]
  env: Record<string, string>
  seed?: string
  resume: boolean
  emit: (event: BaseChatEvent) => void
  onAssistantText?: (delta: string, accumulated: string) => void
  onTurnComplete?: (accumulated: string) => void
}

// Generic streaming-input chat run. On a new session we assign our own stable
// UUID (options.sessionId); on rehydration we resume the on-disk session
// (options.resume) with an empty mailbox so the SDK loads history and idles.
export function startResumableChat(opts: StartResumableChatOptions): ResumableRun {
  const controller = new AbortController()
  let queryRef: Query | null = null
  let mailbox: Mailbox | null = null
  let stopped = false
  let accumulated = ''

  const done = (async (): Promise<void> => {
    mailbox = createMailbox(opts.resume ? undefined : opts.seed)
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt: mailbox.stream,
      options: {
        model: opts.model,
        allowedTools: opts.allowedTools,
        permissionMode: 'bypassPermissions',
        settingSources: opts.settingSources,
        includePartialMessages: true,
        cwd: opts.cwd,
        env: opts.env,
        abortController: controller,
        ...(opts.resume ? { resume: opts.sessionId } : { sessionId: opts.sessionId }),
      },
    })
    queryRef = q

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          accumulated += event.delta.text
          opts.emit({ type: 'token', text: event.delta.text })
          opts.onAssistantText?.(event.delta.text, accumulated)
        }
      } else if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            opts.emit({ type: 'tool', name: block.name, summary: summarizeTool(block) })
          }
        }
      } else if (message.type === 'result') {
        if (stopped) continue
        opts.onTurnComplete?.(accumulated)
        accumulated = ''
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
    logger.error('Resumable chat failed', message)
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
