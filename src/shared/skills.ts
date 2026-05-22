import { z } from 'zod'

// One skill as shown in the list (parsed from SKILL.md frontmatter).
export const skillMetaSchema = z.object({
  id: z.string(), // folder name under ~/.claude/skills
  name: z.string(), // frontmatter `name`, falls back to id
  description: z.string(), // frontmatter `description`, '' if absent
  trigger: z.string().optional(), // frontmatter `trigger`, e.g. /graphify
  argumentHint: z.string().optional(), // frontmatter `argument-hint`
  allowedToolsCount: z.number(), // length of frontmatter `allowed-tools`
  path: z.string(), // absolute path to the skill directory
})

// A single skill plus its rendered body for the detail pane.
export const skillDetailSchema = z.object({
  meta: skillMetaSchema,
  content: z.string(), // markdown body, frontmatter stripped
})

export type SkillMeta = z.infer<typeof skillMetaSchema>
export type SkillDetail = z.infer<typeof skillDetailSchema>
