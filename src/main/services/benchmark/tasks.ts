// src/main/services/benchmark/tasks.ts
import type { BenchmarkTask } from '@main/services/benchmark/types'

// Frozen read-only benchmark tasks. Each runs against the atlas-os repo at the
// current commit with read-only tools only. `assert` gates validity (defends the
// cheap-failure trap). Keep tasks read-only and their assertions verifiable.
export const TASKS: BenchmarkTask[] = [
  {
    id: 'explain-kpi',
    prompt:
      'Read src/shared/kpi.ts in this repo. In one paragraph, explain how the expected token count is computed (the baseline model). Mention what inputs the scope regression uses.',
    assert: { type: 'regex', value: 'files|dirs|regression|scope' },
  },
  {
    id: 'find-infra-watcher',
    prompt:
      'Which file in this repo implements the infra-change watcher that writes rows into the ecosystem_changes table? Reply with the file path.',
    assert: { type: 'includes', value: 'infra.ts' },
  },
  {
    id: 'list-trpc-routers',
    prompt:
      'List the tRPC sub-routers registered in the application root router (src/main/trpc/router.ts).',
    assert: { type: 'includes', value: 'productivity' },
  },
  {
    id: 'subscription-env',
    prompt:
      'What does the subscriptionEnv helper in src/main/services/claude.ts do, and why? Be specific about which environment variables it removes.',
    assert: { type: 'regex', value: 'ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN' },
  },
  {
    id: 'app-paths',
    prompt:
      'Read src/main/paths.ts. What does appPaths() return? List a few of the path keys it provides.',
    assert: { type: 'regex', value: 'userData|claudeDir|migrations' },
  },
  {
    // Long-output task: bounded input (one small file) but an explicitly verbose
    // answer, so OUTPUT tokens dominate. This is where response-style infra (e.g.
    // caveman terseness) is measurable — watch the `output` column, not total.
    id: 'verbose-paths',
    prompt:
      'Read src/main/paths.ts. Write a detailed ~400-word explanation of appPaths(): describe every path key it returns, what each is for, and the packaged-vs-dev difference. Be thorough and complete.',
    assert: { type: 'regex', value: 'userData|migrations|claude' },
  },
]
