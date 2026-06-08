import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@main/logger'
import { createMailbox, type Mailbox } from '@main/services/skillImprover/mailbox'
import { buildImproverPrompt, REPORT_SENTINEL } from '@main/services/skillImprover/prompt'
import { findSkillCreatorPath } from '@main/services/skillImprover/skillCreator'
import {
  cleanupSession,
  createSession,
  type ImproverSession,
  restoreBackup,
} from '@main/services/skillImprover/workspace'
import type { ImproverEvent } from '@shared/ipc-events'
import { parseImproverReport } from '@shared/skillImprover'

const IMPROVER_TOOLS = [
  'Task',
  'Skill',
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'TodoWrite',
  'WebSearch',
  'WebFetch',
]

// Strip metered API keys so the spawned CLI uses the user's Pro/Max OAuth.
function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

export interface ImproverRun {
  reply: (text: string) => void
  accept: () => Promise<void>
  reject: () => Promise<void>
  cancel: () => void
  done: Promise<void>
}

export interface StartImproverOptions {
  requestId: string
  skillId: string
  model: string
  emit: (event: ImproverEvent) => void
}

// Start an interactive skill-improver session. Returns handles to feed user
// replies and to finalize (accept = keep + cleanup; reject/cancel = restore +
// cleanup). The SDK runs in streaming-input mode so the session stays open
// across turns until the mailbox is closed by accept/reject/cancel.
export function startImproverRun(opts: StartImproverOptions): ImproverRun {
  const controller = new AbortController()
  let queryRef: Query | null = null
  let mailbox: Mailbox | null = null
  let session: ImproverSession | null = null
  let sentinelSeen = false
  let textSinceTurn = ''

  // Watch streamed text for the report sentinel; on a hit, read + parse the
  // report file and emit it. Guarded so it only fires once.
  async function checkSentinel() {
    if (sentinelSeen || !session) return
    if (!textSinceTurn.includes(REPORT_SENTINEL)) return
    sentinelSeen = true
    try {
      const raw = await readFile(session.reportPath, 'utf8')
      const report = parseImproverReport(raw)
      if (report) opts.emit({ type: 'report', report })
      else opts.emit({ type: 'error', message: 'Report file was malformed' })
    } catch {
      opts.emit({ type: 'error', message: 'Report file was not found' })
    }
  }

  const done = (async (): Promise<void> => {
    const skillCreatorPath = await findSkillCreatorPath()
    if (!skillCreatorPath) {
      opts.emit({
        type: 'error',
        message: 'skill-creator plugin not found in ~/.claude/plugins',
      })
      return
    }

    session = await createSession(opts.requestId, opts.skillId)
    const prompt = buildImproverPrompt({
      skillCreatorPath,
      skillPath: session.skillPath,
      skillName: basename(session.skillPath),
      workspace: session.workspace,
      reportPath: session.reportPath,
    })

    mailbox = createMailbox(prompt)

    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt: mailbox.stream,
      options: {
        model: opts.model,
        allowedTools: IMPROVER_TOOLS,
        permissionMode: 'bypassPermissions',
        settingSources: ['user'],
        includePartialMessages: true,
        cwd: homedir(),
        env: subscriptionEnv(),
        abortController: controller,
      },
    })
    queryRef = q

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (message.type === 'stream_event') {
        const event = message.event
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          textSinceTurn += event.delta.text
          opts.emit({ type: 'token', text: event.delta.text })
          await checkSentinel()
        }
      } else if (message.type === 'assistant') {
        // Surface tool calls as compact transcript lines.
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            opts.emit({ type: 'tool', name: block.name, summary: summarizeTool(block) })
          }
        }
      } else if (message.type === 'result') {
        // End of a turn → the agent is waiting for the next user reply.
        textSinceTurn = ''
        opts.emit({ type: 'awaiting-input' })
      }
    }
  })().catch((error) => {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Improver run failed', message)
    opts.emit({ type: 'error', message })
  })

  return {
    reply: (text: string) => mailbox?.push(text),
    accept: async () => {
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      await done
      if (session) await cleanupSession(session)
      opts.emit({ type: 'done' })
    },
    reject: async () => {
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      await done
      if (session) {
        await restoreBackup(session)
        await cleanupSession(session)
      }
      opts.emit({ type: 'aborted' })
    },
    cancel: () => {
      mailbox?.close()
      controller.abort()
      queryRef?.interrupt().catch(() => {})
      void done.then(async () => {
        if (session) {
          await restoreBackup(session)
          await cleanupSession(session)
        }
        opts.emit({ type: 'aborted' })
      })
    },
    done,
  }
}

// A short human-readable label for a tool_use block, e.g. "Bash: python -m ...".
function summarizeTool(block: { name: string; input: unknown }): string {
  const input = block.input as Record<string, unknown> | undefined
  if (!input) return block.name
  const hint =
    (typeof input.command === 'string' && input.command) ||
    (typeof input.file_path === 'string' && input.file_path) ||
    (typeof input.description === 'string' && input.description) ||
    (typeof input.skill === 'string' && input.skill) ||
    ''
  const text = String(hint).slice(0, 80)
  return text ? `${block.name}: ${text}` : block.name
}
