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
  return env
}
