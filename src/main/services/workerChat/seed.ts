// The opening user message for a worker chat session. Frames the worker as a
// full-access coding agent on the atlas-os repo and teaches the options
// convention that the renderer turns into clickable chips.

export interface WorkerChatSeedOptions {
  // Autonomous end-to-end mode: authorize the worker to finish the task without
  // pausing for confirmation, including committing, pushing, merging to main,
  // and running the real deploy protocol. Off by default.
  autonomous?: boolean
}

// The autonomous directive. Embeds the canonical deploy sequence verbatim so an
// autonomous run is self-sufficient (no dependency on the agent recalling the
// knowledge store), and cites the authoritative KB article so the two can be
// reconciled if the protocol changes. Source of truth: the knowledge-store
// article `[[no-push-user-pushes]]` ("Deploy protocol").
const AUTONOMOUS_DIRECTIVE = [
  '',
  '=== AUTONOMOUS MODE (enabled for this session) ===',
  'You are authorized to complete this task end-to-end WITHOUT pausing for user',
  'confirmation. The usual "ask before you push, merge, or deploy" convention is',
  'OVERRIDDEN for this session: you may commit, push, open a PR, merge to main,',
  'and run the real deploy protocol on your own judgment. Do not stop to ask for',
  'permission for those actions — only stop if you are genuinely blocked or the',
  'task is ambiguous.',
  '',
  'Deploy protocol — make intermediate commits while working, then on deploy run',
  'this canonical sequence verbatim:',
  '  squash → push → PR → merge to main, THEN `pnpm dist` → quit the running app',
  '  → `ditto`-swap `/Applications/Atlas OS.app` → relaunch.',
  '',
  'Authoritative source of truth for this protocol: the knowledge-store article',
  '[[no-push-user-pushes]] ("Deploy protocol"). If it disagrees with the steps',
  'above, follow the article and flag the discrepancy.',
  '=== END AUTONOMOUS MODE ===',
  '',
].join('\n')

export function buildWorkerChatSeed(
  firstMessage: string,
  opts: WorkerChatSeedOptions = {},
): string {
  const lines = [
    'You are a coding worker embedded in the atlas-os desktop app.',
    'You have full read/write access to this repository (Read, Write, Edit, Bash, Glob, Grep, Task, TodoWrite) and may modify files to complete the task.',
    'When you want the user to choose between options, end that turn with a fenced block:',
    '```options',
    'First choice',
    'Second choice',
    '```',
    'Work carefully and explain what you change. English only.',
  ]
  if (opts.autonomous) lines.push(AUTONOMOUS_DIRECTIVE)
  lines.push("The user's first message:", '', firstMessage)
  return lines.join('\n')
}
