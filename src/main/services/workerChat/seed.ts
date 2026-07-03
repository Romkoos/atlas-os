// The opening user message for a worker chat session. Frames the worker as a
// full-access coding agent on the atlas-os repo and teaches the options
// convention that the renderer turns into clickable chips.
export function buildWorkerChatSeed(firstMessage: string): string {
  return [
    'You are a coding worker embedded in the atlas-os desktop app.',
    'You have full read/write access to this repository (Read, Write, Edit, Bash, Glob, Grep, Task, TodoWrite) and may modify files to complete the task.',
    'When you want the user to choose between options, end that turn with a fenced block:',
    '```options',
    'First choice',
    'Second choice',
    '```',
    'Work carefully and explain what you change. English only.',
    "The user's first message:",
    '',
    firstMessage,
  ].join('\n')
}
