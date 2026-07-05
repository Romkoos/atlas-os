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
  // Seeded into the mailbox when resume === true so the SDK, after loading the
  // on-disk transcript, immediately processes a continuation turn instead of
  // idling. Undefined on a plain reattach (idle) or a fresh session.
  resumeMessage?: string
  emit: (event: BaseChatEvent) => void
  // Called on every SDK rate_limit_event so the caller can cache account usage.
  onRateLimit?: (info: {
    status: 'allowed' | 'allowed_warning' | 'rejected'
    utilization?: number
    resetsAt?: number
    rateLimitType?: string
  }) => void
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

  const STALL_MS = 90_000
  let watchdog: ReturnType<typeof setTimeout> | null = null
  let idle = false // true between a clean awaiting-input and the next activity
  const clearWatchdog = () => {
    if (watchdog) clearTimeout(watchdog)
    watchdog = null
  }
  const armWatchdog = () => {
    clearWatchdog()
    if (stopped || idle) return
    watchdog = setTimeout(() => {
      if (stopped || idle) return
      // No SDK activity for STALL_MS while mid-turn — treat as a dead stream.
      // Mark this run stopped BEFORE aborting so neither the outer `.catch`
      // nor the post-loop guard re-emits: the registry only wants one `error`.
      stopped = true
      opts.emit({ type: 'error', message: 'Run stalled — reconnecting' })
      controller.abort()
      queryRef?.interrupt().catch(() => {})
    }, STALL_MS)
  }

  const done = (async (): Promise<void> => {
    mailbox = createMailbox(opts.resume ? opts.resumeMessage : opts.seed)
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
      idle = false
      armWatchdog()
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
            opts.emit({
              type: 'tool',
              name: block.name,
              summary: summarizeTool(block),
              toolId: block.id,
            })
          }
        }
      } else if (message.type === 'user') {
        const content = message.message.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result') {
              opts.emit({
                type: 'tool-result',
                toolId: block.tool_use_id,
                resultText: toolResultText(block.content),
                isError: block.is_error === true,
              })
            }
          }
        }
      } else if (message.type === 'system' && message.subtype === 'api_retry') {
        // The SDK hit a retryable API error (incl. connection timeouts after
        // sleep, error_status === null) and will retry after a delay. Surface it
        // so the UI shows "reconnecting" instead of a silent hang.
        opts.emit({
          type: 'reconnecting',
          attempt: message.attempt,
          maxRetries: message.max_retries,
          delayMs: message.retry_delay_ms,
        })
      } else if (message.type === 'rate_limit_event') {
        const info = message.rate_limit_info
        opts.onRateLimit?.({
          status: info.status,
          utilization: info.utilization,
          resetsAt: info.resetsAt,
          rateLimitType: info.rateLimitType,
        })
        opts.emit({
          type: 'rate-limit',
          status: info.status,
          utilization: info.utilization,
          resetsAt: info.resetsAt,
          rateLimitType: info.rateLimitType,
        })
      } else if (message.type === 'result') {
        if (stopped) continue
        opts.onTurnComplete?.(accumulated)
        accumulated = ''
        if (message.subtype === 'success') {
          opts.emit({ type: 'awaiting-input' })
          idle = true
          clearWatchdog()
        } else {
          const reason = message.errors?.join('; ') || message.subtype
          opts.emit({ type: 'error', message: `Chat run failed: ${reason}` })
        }
      }
    }
    clearWatchdog()
    if (!stopped && !idle) {
      opts.emit({ type: 'error', message: 'Chat stream ended unexpectedly' })
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
      clearWatchdog()
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      void done.then(() => opts.emit({ type: 'aborted' }))
    },
    done,
  }
}

// tool_result content is either a string or an array of blocks; flatten to text
// and cap it so a huge file/bash dump does not bloat the event buffer.
const RESULT_CAP = 4000
function toolResultText(content: unknown): string {
  let text: string
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    text = content
      .map((b) =>
        b && typeof b === 'object' && 'text' in b ? String((b as { text: unknown }).text) : '',
      )
      .join('')
  } else {
    text = ''
  }
  return text.length > RESULT_CAP ? `${text.slice(0, RESULT_CAP)}\n…(truncated)` : text
}

function summarizeTool(block: { name: string; input: unknown }): string {
  const input = block.input as Record<string, unknown> | undefined
  if (!input) return block.name
  const hint =
    (typeof input.skill === 'string' && input.skill) ||
    (typeof input.subagent_type === 'string' && input.subagent_type) ||
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.pattern === 'string' && input.pattern) ||
    (typeof input.command === 'string' && input.command) ||
    (typeof input.description === 'string' && input.description) ||
    ''
  const text = String(hint).slice(0, 80)
  return text ? `${block.name}: ${text}` : block.name
}
