import {
  CATEGORY_LABELS,
  IDEA_SENTINEL_END,
  IDEA_SENTINEL_START,
  ROADMAP_CATEGORIES,
  ROADMAP_PRIORITIES,
  type RoadmapItem,
} from '@shared/roadmap'

// The opening user message for a roadmap brainstorming session. It hands the
// agent the user's raw idea, the taxonomy it must fit into, the existing ideas
// (to pick the right category and avoid duplicates), and the exact hand-off
// contract. Language rule: converse in the user's language, but the final card
// is ALWAYS English.
export function buildRoadmapChatSeed(idea: string, existing: RoadmapItem[]): string {
  const categories = ROADMAP_CATEGORIES.map((c) => `  - "${c}" — ${CATEGORY_LABELS[c]}`).join('\n')
  const existingList =
    existing.length > 0
      ? existing.map((i) => `  - [${i.category}] ${i.title}`).join('\n')
      : '  (none yet)'

  return [
    "You are the Idea Incubator for Atlas OS — a macOS desktop control panel for AI tools (Electron + React + tRPC + SQLite, driving Claude Code via the Agent SDK on the user's subscription).",
    '',
    'The user wants to add a new feature idea to the Atlas OS roadmap. Your job: take their raw idea, brainstorm it WITH them into a sharp, well-scoped feature, then save it.',
    '',
    "The user's idea:",
    `"""${idea}"""`,
    '',
    '## How to work',
    '- Have a short, focused brainstorming conversation. Ask ONE question at a time (purpose, scope, constraints, what makes it valuable). Keep it tight — a few exchanges, not an interrogation.',
    '- You have read-only access to this repository (Read, Grep, Glob). Use it to ground the idea in how Atlas OS actually works and to write an accurate implementation brief.',
    '- LANGUAGE: reply to the user in the SAME language they use. But the final saved card MUST be written entirely in ENGLISH regardless of the conversation language.',
    '',
    '## Taxonomy',
    'Categories (pick exactly one that fits best):',
    categories,
    `Priorities: ${ROADMAP_PRIORITIES.map((p) => `"${p}"`).join(', ')}`,
    '',
    '## Existing roadmap items (avoid duplicates; pick a consistent category)',
    existingList,
    '',
    '## Saving the idea',
    'When — and only when — the idea is fully formed and the user is happy, output the finished card as a JSON object wrapped EXACTLY in these sentinels, on their own lines:',
    '',
    IDEA_SENTINEL_START,
    '{',
    '  "title": "<concise English title>",',
    '  "description": "<1-3 sentence English description of what it is and why it fits Atlas OS>",',
    '  "category": "<one of the category keys above>",',
    '  "priority": "<low | medium | high>",',
    '  "claudePrompt": "<a short English brief for Claude Code: what to build, where it lives in this codebase, and the key pieces to touch>"',
    '}',
    IDEA_SENTINEL_END,
    '',
    'Rules for the block: valid JSON only (no comments, no trailing commas), all fields in English, emit it exactly once. After you emit it, briefly confirm to the user (in their language) that the idea was saved.',
    '',
    'Start now: acknowledge the idea in one line, then ask your first brainstorming question.',
  ].join('\n')
}
