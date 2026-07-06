import type { Dirent } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

// Finds the SDK transcript file for a session: ~/.claude/projects encodes cwd as
// one subdir per project, each holding <sessionId>.jsonl. Returns the first match
// or null (missing dir / no such session).
export async function locateTranscript(
  projectsDir: string,
  sessionId: string,
): Promise<string | null> {
  const target = `${sessionId}.jsonl`
  let entries: Dirent[]
  try {
    entries = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === target) return join(projectsDir, entry.name)
    if (entry.isDirectory()) {
      const inner = join(projectsDir, entry.name)
      let files: string[]
      try {
        files = await readdir(inner)
      } catch {
        continue
      }
      if (files.includes(target)) return join(inner, target)
    }
  }
  return null
}
