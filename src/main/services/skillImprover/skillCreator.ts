import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeConfigDir } from '@main/paths'

// Plugins of the PRIVATE subscription (~/.claude-private/plugins), not ~/.claude.
const PLUGINS_ROOT = join(claudeConfigDir(), 'plugins')

async function exists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

// Locate skill-creator's SKILL.md. The cache path has a volatile version segment
// (e.g. ".../skill-creator/<version>/skills/skill-creator/"), so scan it; fall
// back to the stable marketplace path. Returns null if not installed.
export async function findSkillCreatorPath(
  pluginsRoot: string = PLUGINS_ROOT,
): Promise<string | null> {
  const cacheBase = join(pluginsRoot, 'cache', 'claude-plugins-official', 'skill-creator')
  let versions: string[] = []
  try {
    versions = await readdir(cacheBase)
  } catch {
    versions = []
  }
  for (const v of versions) {
    const candidate = join(cacheBase, v, 'skills', 'skill-creator', 'SKILL.md')
    if (await exists(candidate)) return candidate
  }

  const marketplace = join(
    pluginsRoot,
    'marketplaces',
    'claude-plugins-official',
    'plugins',
    'skill-creator',
    'skills',
    'skill-creator',
    'SKILL.md',
  )
  if (await exists(marketplace)) return marketplace

  return null
}
