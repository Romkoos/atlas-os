import { enrichedPath } from '@main/services/llm/shellPath'

// Strip metered API keys so spawned SDK calls use the user's Pro/Max OAuth.
// Mirrors the local copies in benchmark/runner.ts and skillImprover/run.ts; new
// code imports this shared version instead of re-declaring it.
export function subscriptionEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  // A packaged (Finder/Dock-launched) app gets launchd's minimal PATH, so the
  // agent's Bash tool can't find user-installed CLIs (graphify, uv). Enrich the
  // spawned env with the real login-shell PATH resolved at startup. No-op in dev.
  env.PATH = enrichedPath()
  return env
}
