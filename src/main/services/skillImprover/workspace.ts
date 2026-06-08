import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SKILLS_DIR } from '@main/services/skills'

export interface ImproverSession {
  requestId: string
  skillId: string
  skillPath: string // <skillsDir>/<skillId>
  skillFile: string // <skillPath>/SKILL.md
  workspace: string // temp dir for all agent working files
  backupFile: string // <workspace>/backup/SKILL.md
  reportPath: string // <workspace>/report.json
}

// Create a temp workspace and snapshot the skill's current SKILL.md so the run
// can be reverted. The agent edits the real file in place; restoreBackup undoes
// that, cleanupSession deletes the workspace.
export async function createSession(
  requestId: string,
  skillId: string,
  skillsDir: string = SKILLS_DIR,
): Promise<ImproverSession> {
  const skillPath = join(skillsDir, skillId)
  const skillFile = join(skillPath, 'SKILL.md')
  const workspace = await mkdtemp(join(tmpdir(), 'atlas-improver-'))
  const backupDir = join(workspace, 'backup')
  await mkdir(backupDir, { recursive: true })
  const backupFile = join(backupDir, 'SKILL.md')
  await cp(skillFile, backupFile)
  return {
    requestId,
    skillId,
    skillPath,
    skillFile,
    workspace,
    backupFile,
    reportPath: join(workspace, 'report.json'),
  }
}

// Revert the skill to the backup taken at session start (reject/cancel path).
export async function restoreBackup(session: ImproverSession): Promise<void> {
  await cp(session.backupFile, session.skillFile)
}

// Remove the temp workspace (and the backup inside it). Safe to call twice.
export async function cleanupSession(session: ImproverSession): Promise<void> {
  await rm(session.workspace, { recursive: true, force: true })
}
