import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '@main/logger'
import { claudeCliPath } from '@main/paths'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import type { UsageWindow } from '@shared/ipc-events'

const execFileP = promisify(execFile)

// The live SDK `rate_limit_event` only fires during a chat run (and only for
// whichever window the server flags), so at rest the gauge has no data. This
// module periodically runs the `claude` CLI's `/usage` slash command — a LOCAL
// command that does no model inference (num_turns: 0, total_cost_usd: 0, zero
// tokens) — and parses its text output into a RateLimitInfo. We shell out to the
// CLI rather than the agent SDK because the SDK only surfaces `/usage`'s first
// summary line, whereas `claude -p "/usage" --output-format json` returns the
// full per-window breakdown in its `result` field. The CLI authenticates itself
// (same subscription auth atlas's chats use), so this works even where a direct
// `/api/oauth/usage` call can't (the OAuth token isn't exposed to our process).

const DEFAULT_INTERVAL_MS = 120_000
const RUN_TIMEOUT_MS = 20_000

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Parse a `/usage` reset stamp like "Jul 5 at 3:30pm (Asia/Jerusalem)" into epoch
 * ms. The stamp is in the machine's local timezone (the CLI prints the local tz),
 * and the app runs in that same tz, so we build a local Date from the components.
 * The year is absent, so we assume the current year and roll forward one year if
 * that would place the reset far in the past (handles a Dec→Jan window rollover).
 * Returns undefined when the string doesn't match the expected shape.
 */
export function parseResetToMs(str: string, now: number): number | undefined {
  const m = str.match(/([A-Za-z]{3})\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i)
  if (!m) return undefined
  const monthIdx = MONTHS.indexOf(m[1].toLowerCase())
  if (monthIdx < 0) return undefined
  const day = Number(m[2])
  let hour = Number(m[3]) % 12
  if (m[5].toLowerCase() === 'pm') hour += 12
  const minute = m[4] ? Number(m[4]) : 0

  const year = new Date(now).getFullYear()
  let ts = new Date(year, monthIdx, day, hour, minute, 0, 0).getTime()
  // Reset times are always in the near future; if we computed a date well in the
  // past, the real reset is the same date next year.
  if (ts < now - 2 * 24 * 60 * 60 * 1000) {
    ts = new Date(year + 1, monthIdx, day, hour, minute, 0, 0).getTime()
  }
  return ts
}

function windowLabel(rawLabel: string): string | null {
  const l = rawLabel.toLowerCase()
  if (l.includes('session')) return 'session'
  const model = rawLabel.match(/week\s*\(([^)]+)\)/i)?.[1]
  if (l.includes('week')) {
    if (!model || /all models/i.test(model)) return 'week'
    return `week · ${model}`
  }
  return null
}

function statusFor(pct: number): UsageWindow['status'] {
  return pct >= 100 ? 'rejected' : pct >= 90 ? 'allowed_warning' : 'allowed'
}

/**
 * Parse `/usage` result text into every reported window (session + weekly),
 * preserving order. Utilization is a 0–1 fraction (the widget clamps it for
 * display); resetsAt is epoch ms. Returns [] when no usage lines are present.
 */
export function parseUsageWindows(text: string, now: number): UsageWindow[] {
  const windows: UsageWindow[] = []
  // e.g. "Current session: 70% used · resets Jul 5 at 3:30pm (Asia/Jerusalem)"
  const lineRe = /^(.*?):\s*(\d+)%\s*used\b(?:[^\n]*?resets\s+([^\n]+))?/gim
  for (const m of text.matchAll(lineRe)) {
    const label = windowLabel(m[1])
    if (label === null) continue
    const pct = Number(m[2])
    windows.push({
      label,
      status: statusFor(pct),
      utilization: pct / 100,
      resetsAt: m[3] ? parseResetToMs(m[3].trim(), now) : undefined,
    })
  }
  return windows
}

// Run `claude -p "/usage" --output-format json` and return its `result` text, or
// null on failure. `/usage` is a local command (no model inference → zero tokens);
// the only overhead is spawning the CLI.
//
// In a packaged build we invoke the Agent SDK's own bundled `claude` by absolute
// path (claudeCliPath) — a GUI app launched from Finder/Dock gets launchd's minimal
// PATH, and the user's `claude` may live outside it (e.g. cmux's bundled copy that
// the login shell never adds to PATH), so relying on the shell to resolve it fails
// silently. In dev we still go through a login shell, which inherits the developer's
// full terminal PATH.
async function runUsageCommand(): Promise<string | null> {
  const bin = claudeCliPath()
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const { stdout } = bin
      ? await execFileP(bin, ['-p', '/usage', '--output-format', 'json'], {
          timeout: RUN_TIMEOUT_MS,
          env: subscriptionEnv(),
          maxBuffer: 4 * 1024 * 1024,
        })
      : await execFileP(shell, ['-lc', 'claude -p "/usage" --output-format json'], {
          timeout: RUN_TIMEOUT_MS,
          env: subscriptionEnv(),
          maxBuffer: 4 * 1024 * 1024,
        })
    const parsed = JSON.parse(stdout.trim()) as {
      result?: string
      num_turns?: number
      total_cost_usd?: number
    }
    // A local command does no inference; guard against a misfire that would
    // silently burn subscription tokens on every poll.
    if (typeof parsed.num_turns === 'number' && parsed.num_turns > 0) {
      logger.warn('Subscription usage /usage ran a model turn (unexpected)', {
        numTurns: parsed.num_turns,
        costUsd: parsed.total_cost_usd,
      })
    }
    return typeof parsed.result === 'string' ? parsed.result : null
  } catch (error) {
    logger.warn('Subscription usage /usage run failed', error)
    return null
  }
}

/**
 * Run `/usage` once and return the parsed windows, or null on failure / empty
 * output. Shared by the periodic poll and the manual refresh mutation.
 */
export async function pollUsageOnce(): Promise<UsageWindow[] | null> {
  const text = await runUsageCommand()
  if (!text) return null
  const windows = parseUsageWindows(text, Date.now())
  if (windows.length === 0) {
    logger.warn('Subscription usage poll: /usage output not parseable', {
      sample: text.slice(0, 200),
    })
    return null
  }
  return windows
}

/**
 * Poll `/usage` immediately and then every `intervalMs`, feeding each parsed set
 * of windows to `onWindows`. Returns a stop function. All failures are swallowed
 * (logged) so a transient hiccup never disrupts the app — the widget keeps its
 * last value. The client-side countdown ticks every second independently, so a
 * coarse poll interval is fine.
 */
export function startUsagePolling(
  onWindows: (windows: UsageWindow[]) => void,
  intervalMs = DEFAULT_INTERVAL_MS,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let loggedFirst = false

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const windows = await pollUsageOnce()
      if (windows && !stopped) {
        if (!loggedFirst) {
          loggedFirst = true
          logger.info('Subscription usage poll: first snapshot', {
            windows: windows.map((w) => `${w.label} ${Math.round(w.utilization * 100)}%`),
          })
        }
        onWindows(windows)
      }
    } catch (error) {
      logger.debug('Subscription usage poll failed', error)
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs)
    }
  }

  void tick()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
