import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanupSession,
  createSession,
  restoreBackup,
} from '@main/services/skillImprover/workspace'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let skillsDir: string

beforeEach(async () => {
  skillsDir = await mkdtemp(join(tmpdir(), 'atlas-ws-skills-'))
  await mkdir(join(skillsDir, 'graphify'), { recursive: true })
  await writeFile(join(skillsDir, 'graphify', 'SKILL.md'), 'ORIGINAL\n', 'utf8')
})
afterEach(async () => {
  await rm(skillsDir, { recursive: true, force: true })
})

describe('skill-improver workspace', () => {
  it('createSession backs up the original SKILL.md and exposes paths', async () => {
    const s = await createSession('req-1', 'graphify', skillsDir)
    expect(s.skillPath).toBe(join(skillsDir, 'graphify'))
    expect(existsSync(s.workspace)).toBe(true)
    expect(await readFile(s.backupFile, 'utf8')).toBe('ORIGINAL\n')
    expect(s.reportPath.endsWith('report.json')).toBe(true)
    await cleanupSession(s)
  })

  it('restoreBackup copies the backup back over an edited SKILL.md', async () => {
    const s = await createSession('req-2', 'graphify', skillsDir)
    await writeFile(join(s.skillPath, 'SKILL.md'), 'EDITED\n', 'utf8')
    await restoreBackup(s)
    expect(await readFile(join(s.skillPath, 'SKILL.md'), 'utf8')).toBe('ORIGINAL\n')
    await cleanupSession(s)
  })

  it('cleanupSession removes the workspace', async () => {
    const s = await createSession('req-3', 'graphify', skillsDir)
    await cleanupSession(s)
    expect(existsSync(s.workspace)).toBe(false)
  })
})
