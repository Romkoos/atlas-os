import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { SkillDetail, SkillMeta } from '@shared/skills'
import { load } from 'js-yaml'

export const SKILLS_DIR = join(homedir(), '.claude', 'skills')

// Captures the YAML between the leading `---` fence and the rest as the body.
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = raw.match(FRONTMATTER)
  if (!match) return { data: {}, body: raw }
  const parsed = load(match[1])
  const data = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  return { data, body: match[2] }
}

function allowedToolsCount(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean).length
  }
  return 0
}

function toMeta(id: string, dir: string, data: Record<string, unknown>): SkillMeta {
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : id
  return {
    id,
    name,
    description: typeof data.description === 'string' ? data.description.trim() : '',
    trigger: typeof data.trigger === 'string' ? data.trigger : undefined,
    argumentHint: typeof data['argument-hint'] === 'string' ? data['argument-hint'] : undefined,
    allowedToolsCount: allowedToolsCount(data['allowed-tools']),
    path: join(dir, id),
  }
}

export async function listSkills(dir: string = SKILLS_DIR): Promise<SkillMeta[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return [] // directory missing → no skills
  }

  const skills: SkillMeta[] = []
  for (const entry of entries) {
    // Symlinked dirs are intentionally excluded: isDirectory() is false for symlinks (no withFileTypes follow).
    if (!entry.isDirectory()) continue
    let raw: string
    try {
      raw = await readFile(join(dir, entry.name, 'SKILL.md'), 'utf8')
    } catch {
      continue // no SKILL.md → not a skill (e.g. *-workspace dirs)
    }
    try {
      const { data } = parseFrontmatter(raw)
      skills.push(toMeta(entry.name, dir, data))
    } catch (error) {
      console.warn(`skills: skipping "${entry.name}" — failed to parse frontmatter`, error)
    }
  }

  skills.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  return skills
}

function assertSafeId(id: string, dir: string): void {
  if (!id || id.includes('/') || id.includes('\\') || id.includes('..') || isAbsolute(id)) {
    throw new Error(`Invalid skill id: ${id}`)
  }
  // The resolved skill dir must be a direct child of `dir`.
  if (resolve(dir) !== resolve(dir, id, '..')) {
    throw new Error(`Invalid skill id: ${id}`)
  }
}

export async function readSkill(id: string, dir: string = SKILLS_DIR): Promise<SkillDetail> {
  assertSafeId(id, dir)
  const raw = await readFile(join(dir, id, 'SKILL.md'), 'utf8')
  try {
    const { data, body } = parseFrontmatter(raw)
    return { meta: toMeta(id, dir, data), content: body }
  } catch (error) {
    throw new Error(`Failed to parse SKILL.md for "${id}": ${(error as Error).message}`)
  }
}
