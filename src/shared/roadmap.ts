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
