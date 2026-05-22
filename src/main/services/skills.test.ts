import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listSkills, readSkill } from '@main/services/skills'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atlas-skills-'))

  // alpha: full frontmatter, folded description, allowed-tools list of 3
  await mkdir(join(dir, 'alpha'), { recursive: true })
  await writeFile(
    join(dir, 'alpha', 'SKILL.md'),
    [
      '---',
      'name: Alpha Skill',
      'description: >',
      '  First line of the description',
      '  that folds onto one line.',
      'trigger: /alpha',
      'argument-hint: "<file>"',
      'allowed-tools:',
      '  - Read',
      '  - Write',
      '  - Bash',
      '---',
      '',
      '# Alpha',
      '',
      'Body content here.',
      '',
    ].join('\n'),
    'utf8',
  )

  // beta: minimal frontmatter, no name → falls back to id
  await mkdir(join(dir, 'beta'), { recursive: true })
  await writeFile(
    join(dir, 'beta', 'SKILL.md'),
    ['---', 'description: Just a description.', '---', '', 'Beta body.', ''].join('\n'),
    'utf8',
  )

  // gamma-workspace: no SKILL.md → must be excluded
  await mkdir(join(dir, 'gamma-workspace'), { recursive: true })
  await writeFile(join(dir, 'gamma-workspace', 'eval.py'), 'print(1)\n', 'utf8')

  // delta: empty dir, no SKILL.md → excluded
  await mkdir(join(dir, 'delta'), { recursive: true })
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('listSkills', () => {
  it('lists only directories containing SKILL.md, sorted by name', async () => {
    const skills = await listSkills(dir)
    expect(skills.map((s) => s.id)).toEqual(['alpha', 'beta'])
  })

  it('parses frontmatter fields', async () => {
    const skills = await listSkills(dir)
    const alpha = skills.find((s) => s.id === 'alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.name).toBe('Alpha Skill')
    expect(alpha?.description).toBe('First line of the description that folds onto one line.')
    expect(alpha?.trigger).toBe('/alpha')
    expect(alpha?.argumentHint).toBe('<file>')
    expect(alpha?.allowedToolsCount).toBe(3)
  })

  it('falls back to folder id when name is absent', async () => {
    const skills = await listSkills(dir)
    const beta = skills.find((s) => s.id === 'beta')
    expect(beta?.name).toBe('beta')
    expect(beta?.allowedToolsCount).toBe(0)
  })

  it('returns [] when the directory does not exist', async () => {
    expect(await listSkills(join(dir, 'does-not-exist'))).toEqual([])
  })
})

describe('readSkill', () => {
  it('returns the markdown body with frontmatter stripped', async () => {
    const detail = await readSkill('alpha', dir)
    expect(detail.meta.name).toBe('Alpha Skill')
    expect(detail.content).toContain('# Alpha')
    expect(detail.content).toContain('Body content here.')
    expect(detail.content).not.toContain('name: Alpha Skill')
  })

  it('rejects path-traversal ids', async () => {
    await expect(readSkill('../beta', dir)).rejects.toThrow()
    await expect(readSkill('alpha/../beta', dir)).rejects.toThrow()
  })
})
