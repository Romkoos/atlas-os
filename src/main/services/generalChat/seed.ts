// The opening user message for a general chat session. Frames the assistant and
// its read-only repo access, then appends the user's first message.
export function buildGeneralChatSeed(firstMessage: string): string {
  return [
    'You are a general-purpose assistant embedded in the atlas-os desktop app.',
    'You have read-only access to this repository (Read, Grep, Glob) if code context helps; you cannot modify files.',
    "Answer conversationally. The user's first message:",
    '',
    firstMessage,
  ].join('\n')
}
