import { claudeConfigDir } from '@main/paths'
import { enrichedPath } from '@main/services/llm/shellPath'

// The one env builder every spawned `claude`/SDK process must use. It does two
// things, both mandatory:
//   1. Pins CLAUDE_CONFIG_DIR to the PRIVATE subscription's config dir
//      (~/.claude-private), so the run authenticates as the private subscription
//      and never touches ~/.claude (the work subscription bound to `claude`).
//      This is the app-wide equivalent of the `claude-private` shell alias.
//   2. Strips metered API keys so the CLI falls back to the private OAuth login
//      rather than billing an API key.
// Any code that spawns a `claude` process MUST route its env through here.
export function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  // Force the private subscription. Set unconditionally so an inherited
  // CLAUDE_CONFIG_DIR (e.g. the app launched from a `claude-private` shell, or
  // any other value) can never redirect the run to a different subscription.
  env.CLAUDE_CONFIG_DIR = claudeConfigDir()
  // A packaged (Finder/Dock-launched) app gets launchd's minimal PATH, so the
  // agent's Bash tool can't find user-installed CLIs (graphify, uv). Enrich the
  // spawned env with the real login-shell PATH resolved at startup. No-op in dev.
  env.PATH = enrichedPath()
  return env
}
