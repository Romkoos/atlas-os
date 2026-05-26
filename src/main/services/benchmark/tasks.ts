// src/main/services/benchmark/tasks.ts
import type { BenchmarkTask } from '@main/services/benchmark/types'

// Frozen read-only benchmark tasks. Each runs against the atlas-os repo at the
// current commit with read-only tools only. `assert` gates validity (defends the
// cheap-failure trap). Keep tasks read-only and their assertions verifiable.
export const TASKS: BenchmarkTask[] = [
  {
    id: 'explain-kpi',
    name: 'explain KPI baseline',
    description:
      'Reads src/shared/kpi.ts and asks the model to explain the scope-regression baseline that estimates expected tokens per session. Mid-size file, moderate input, short factual answer.',
    prompt:
      'Read src/shared/kpi.ts in this repo. In one paragraph, explain how the expected token count is computed (the baseline model). Mention what inputs the scope regression uses.',
    assert: { type: 'regex', value: 'files|dirs|regression|scope' },
  },
  {
    id: 'find-infra-watcher',
    name: 'find infra watcher',
    description:
      'Tiny-output path-finding task: locate the file that writes ecosystem_changes rows. Mostly tests glob/grep navigation, output is ~one line — useful as a low-noise baseline.',
    prompt:
      'Which file in this repo implements the infra-change watcher that writes rows into the ecosystem_changes table? Reply with the file path.',
    assert: { type: 'includes', value: 'infra.ts' },
  },
  {
    id: 'list-trpc-routers',
    name: 'list tRPC routers',
    description:
      'Reads src/main/trpc/router.ts and asks the model to enumerate the registered sub-routers. Small file, small answer — primarily a file-read + listing probe.',
    prompt:
      'List the tRPC sub-routers registered in the application root router (src/main/trpc/router.ts).',
    assert: { type: 'includes', value: 'productivity' },
  },
  {
    id: 'subscription-env',
    name: 'explain subscriptionEnv',
    description:
      'Reads src/main/services/claude.ts and asks what the subscriptionEnv helper does and which environment variables it strips. Short factual explanation.',
    prompt:
      'What does the subscriptionEnv helper in src/main/services/claude.ts do, and why? Be specific about which environment variables it removes.',
    assert: { type: 'regex', value: 'ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN' },
  },
  {
    id: 'app-paths',
    name: 'list appPaths keys',
    description:
      'Reads the tiny 35-line src/main/paths.ts and asks which path keys appPaths() returns. Bounded input → low-variance, good for clean infra comparisons.',
    prompt:
      'Read src/main/paths.ts. What does appPaths() return? List a few of the path keys it provides.',
    assert: { type: 'regex', value: 'userData|claudeDir|migrations' },
  },
  {
    id: 'verbose-paths',
    name: 'verbose appPaths essay',
    description:
      'Reads the same small paths.ts but explicitly demands a ~400-word detailed explanation. OUTPUT tokens dominate → this is where response-style infra (e.g. caveman terseness) becomes measurable; watch the `output` column.',
    prompt:
      'Read src/main/paths.ts. Write a detailed ~400-word explanation of appPaths(): describe every path key it returns, what each is for, and the packaged-vs-dev difference. Be thorough and complete.',
    assert: { type: 'regex', value: 'userData|migrations|claude' },
  },
  {
    id: 'scenario-paths',
    name: 'paths session (4 turns)',
    description:
      'Multi-turn session: 4 follow-up questions about paths.ts in ONE session (via SDK resume). The prefix is created on turn 1 and read on turns 2-4 → row totals show the AMORTIZED cost of a real coding session, not a cold-start.',
    prompt: 'Read src/main/paths.ts. List the keys appPaths() returns.',
    followUps: [
      'What is userData used for?',
      'What is the packaged-vs-dev difference for the migrations path?',
      'Why does infraSnapshot live under userData specifically?',
    ],
    assert: { type: 'regex', value: 'userData|snapshot|migrations' },
  },
]
