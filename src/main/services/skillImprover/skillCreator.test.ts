import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findSkillCreatorPath } from '@main/services/skillImprover/skillCreator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'atlas-sc-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('findSkillCreatorPath', () => {
  it('finds the cached plugin SKILL.md under a version segment', async () => {
    const dir = join(root, 'cache/claude-plugins-official/skill-creator/1.0/skills/skill-creator')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), '# sc', 'utf8')
    const found = await findSkillCreatorPath(root)
    expect(found).toBe(join(dir, 'SKILL.md'))
  })

  it('falls back to the marketplace path', async () => {
    const dir = join(
      root,
      'marketplaces/claude-plugins-official/plugins/skill-creator/skills/skill-creator',
    )
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), '# sc', 'utf8')
    const found = await findSkillCreatorPath(root)
    expect(found).toBe(join(dir, 'SKILL.md'))
  })

  it('returns null when skill-creator is not installed', async () => {
    expect(await findSkillCreatorPath(root)).toBeNull()
  })
})
