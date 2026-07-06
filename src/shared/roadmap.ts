import { z } from 'zod'

// Single source of truth for the Roadmap feature shape (main DB + renderer form).
// A roadmap item is a candidate feature for Atlas OS, browsable and editable on
// the ROADMAP page.

export const ROADMAP_CATEGORIES = [
  'intelligence',
  'observability',
  'macos',
  'connectivity',
  'wow',
] as const
export const ROADMAP_STATUSES = ['todo', 'planned', 'in-progress', 'done'] as const
export const ROADMAP_PRIORITIES = ['low', 'medium', 'high'] as const

export type RoadmapCategory = (typeof ROADMAP_CATEGORIES)[number]
export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number]
export type RoadmapPriority = (typeof ROADMAP_PRIORITIES)[number]

// Human-facing labels (English — atlas-os UI strings are always English).
export const CATEGORY_LABELS: Record<RoadmapCategory, string> = {
  intelligence: 'Intelligence & Automation',
  observability: 'Observability & Insight',
  macos: 'Native macOS Power',
  connectivity: 'Connectivity & Data',
  wow: 'Wow-factor / Experimental',
}

export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  todo: 'To do',
  planned: 'Planned',
  'in-progress': 'In progress',
  done: 'Done',
}

export const PRIORITY_LABELS: Record<RoadmapPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export const roadmapItemSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  description: z.string(),
  category: z.enum(ROADMAP_CATEGORIES),
  status: z.enum(ROADMAP_STATUSES),
  priority: z.enum(ROADMAP_PRIORITIES),
  // English brief for Claude Code explaining what the idea is.
  claudePrompt: z.string(),
  position: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
})
export type RoadmapItem = z.infer<typeof roadmapItemSchema>

// Fields the user supplies when creating an item. `position` is assigned by the
// backend (appended to the target category).
export const roadmapCreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().default(''),
  category: z.enum(ROADMAP_CATEGORIES),
  status: z.enum(ROADMAP_STATUSES).default('todo'),
  priority: z.enum(ROADMAP_PRIORITIES).default('medium'),
  claudePrompt: z.string().default(''),
})
export type RoadmapCreate = z.infer<typeof roadmapCreateSchema>

// ── Agent proposal hand-off ──────────────────────────────────────────────────
// The brainstorm agent emits its finished idea as a JSON block wrapped in these
// sentinels. Main extracts + validates it, then saves. English-only by contract
// (enforced in the seed prompt), regardless of the conversation language.
export const IDEA_SENTINEL_START = '<<<ATLAS_ROADMAP_IDEA>>>'
export const IDEA_SENTINEL_END = '<<<END_ATLAS_ROADMAP_IDEA>>>'

// Extract + validate the proposal from accumulated assistant text. Returns null
// until a complete, well-formed block is present (so callers can retry as more
// text streams). Tolerates an optional ```json fence inside the block.
export function parseRoadmapProposal(text: string): RoadmapCreate | null {
  const start = text.indexOf(IDEA_SENTINEL_START)
  if (start === -1) return null
  const end = text.indexOf(IDEA_SENTINEL_END, start + IDEA_SENTINEL_START.length)
  if (end === -1) return null
  const inner = text.slice(start + IDEA_SENTINEL_START.length, end).trim()
  const json = inner
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    return roadmapCreateSchema.parse(JSON.parse(json))
  } catch {
    return null
  }
}

// Update: every field optional and — crucially — WITHOUT defaults. Reusing
// `roadmapCreateSchema.partial()` would leak the create defaults ('', 'medium'),
// so a status-only update would silently wipe description/priority/claudePrompt.
export const roadmapUpdateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.enum(ROADMAP_CATEGORIES).optional(),
  status: z.enum(ROADMAP_STATUSES).optional(),
  priority: z.enum(ROADMAP_PRIORITIES).optional(),
  claudePrompt: z.string().optional(),
})
export type RoadmapUpdate = z.infer<typeof roadmapUpdateSchema>

// ── Dev pipeline (rocket → plan → build → deploy) ──────────────────────────────

// Pinned label the brainstorm agent must use as its approve option; the renderer
// matches it exactly to flip planned → in-progress and start the build.
export const APPROVE_BUILD_LABEL = '✓ Approve & start building'

// Own-line token the worker emits after a completed deploy (merge to main).
export const DEPLOY_SENTINEL = '<<ATLAS_DEPLOYED>>'

// True when the accumulated assistant text contains the sentinel alone on a line
// (tolerant of surrounding whitespace). A prose mention on a shared line does
// NOT count — mirrors the precision of the roadmap idea sentinel.
export function parseDeploySentinel(text: string): boolean {
  return text.split('\n').some((line) => line.trim() === DEPLOY_SENTINEL)
}

// The worker's binding to the roadmap item it is currently developing.
export const devBindingSchema = z.object({
  itemId: z.string().min(1),
  phase: z.enum(['planning', 'building']),
})
export type DevBinding = z.infer<typeof devBindingSchema>

// Whether a picked chip / typed reply should trigger the approve → build flip.
// Only while planning, and only for the exact pinned label.
export function shouldApproveBuild(binding: DevBinding | null, pickedText: string): boolean {
  return binding?.phase === 'planning' && pickedText === APPROVE_BUILD_LABEL
}

// First message for the PLANNING phase. Wrapped again by the worker seed on the
// server, so it only needs the feature brief + brainstorm contract. It forbids
// code and pins the approve-option label.
export function buildDevPlanKickoff(item: Pick<RoadmapItem, 'title' | 'claudePrompt'>): string {
  return [
    `We are planning a new Atlas OS feature: "${item.title}".`,
    'Feature brief:',
    item.claudePrompt,
    '',
    'This is the PLANNING phase. Brainstorm the design and implementation plan with me:',
    'ask one question at a time, propose 2-3 approaches with trade-offs, and converge on a plan.',
    'Do NOT write code, edit files, or run mutating commands yet.',
    'When the plan is agreed, end that turn with a fenced options block whose FIRST line is',
    `exactly "${APPROVE_BUILD_LABEL}", followed by any refine options. English only.`,
  ].join('\n')
}

// The continuation sent when the user approves the plan. Kicks off the
// autonomous build; the worker waits for the user's "deploy" before shipping and
// emits the sentinel only after the merge lands.
export function buildDevBuildPrompt(): string {
  return [
    'The plan is approved. Implement it autonomously now:',
    'follow the agreed plan, use TDD, and work until the feature is complete and verified.',
    'Do NOT push or merge. When you are done building, stop and wait for me.',
    'When I type "deploy", do squash → PR → merge per the deploy protocol; once the merge',
    `has landed on main, emit ${DEPLOY_SENTINEL} on its own line and write nothing after it.`,
  ].join('\n')
}
