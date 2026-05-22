import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { shell } from 'electron'

export interface MarkdownMeta {
  model: string
  prompt: string
  tokens: number
  createdAt: Date
}

export async function saveMarkdown(
  dir: string,
  content: string,
  meta: MarkdownMeta,
): Promise<string> {
  await mkdir(dir, { recursive: true })
  const stamp = meta.createdAt.toISOString().replace(/[:.]/g, '-')
  const filePath = join(dir, `agent-${stamp}.md`)

  const document = [
    '---',
    `model: ${meta.model}`,
    `created: ${meta.createdAt.toISOString()}`,
    `tokens: ${meta.tokens}`,
    '---',
    '',
    '## Prompt',
    '',
    meta.prompt,
    '',
    '## Response',
    '',
    content,
    '',
  ].join('\n')

  await writeFile(filePath, document, 'utf8')
  return filePath
}

export function revealInFinder(filePath: string): void {
  shell.showItemInFolder(filePath)
}
