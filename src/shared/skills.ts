import { z } from 'zod'

// One skill as shown in the list (parsed from SKILL.md frontmatter).
export const skillMetaSchema = z.object({
  id: z.string(), // folder name under ~/.claude-private/skills
  name: z.string(), // frontmatter `name`, falls back to id
  description: z.string(), // frontmatter `description`, '' if absent
  trigger: z.string().optional(), // frontmatter `trigger`, e.g. /graphify
  argumentHint: z.string().optional(), // frontmatter `argument-hint`
  allowedTools: z.array(z.string()), // tool names from frontmatter `allowed-tools`
  path: z.string(), // absolute path to the skill directory
})

// A single skill plus its rendered body for the detail pane.
export const skillDetailSchema = z.object({
  meta: skillMetaSchema,
  content: z.string(), // markdown body, frontmatter stripped
})

export type SkillMeta = z.infer<typeof skillMetaSchema>
export type SkillDetail = z.infer<typeof skillDetailSchema>

// Group items by the segment of their id before the first dash (e.g. all
// `gsd-*` collapse into one "gsd" group). Single-id prefixes come first, then
// multi-id (collapsible) groups; both alphabetical by prefix. Member order is
// preserved from the input. Used by the Skills page and the benchmark infra
// compare panel (where skills with the same prefix are visually grouped).
export function groupByPrefix<T extends { id: string }>(items: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const dash = item.id.indexOf('-')
    const prefix = dash > 0 ? item.id.slice(0, dash) : item.id
    const arr = groups.get(prefix)
    if (arr) arr.push(item)
    else groups.set(prefix, [item])
  }
  return [...groups.entries()].sort((a, b) => {
    const aMulti = a[1].length > 1 ? 1 : 0
    const bMulti = b[1].length > 1 ? 1 : 0
    return aMulti - bMulti || a[0].localeCompare(b[0])
  })
}

// Mirrors the server-side FRONTMATTER regex in main/services/skills.ts so the
// editor can render a live preview from its own buffer without a round-trip.
// Returns the raw YAML (without the --- fences) and the body after the fence.
const FRONTMATTER_FENCE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n(?:\r?\n)?([\s\S]*)$/

export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const match = raw.match(FRONTMATTER_FENCE)
  if (!match) return { frontmatter: '', body: raw }
  return { frontmatter: match[1], body: match[2] }
}
