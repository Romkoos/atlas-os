import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { locateTranscript } from './locateTranscript'

describe('locateTranscript', () => {
  const dirs: string[] = []
  afterAll(() => {}) // tmp dirs are OS-cleaned

  it('finds <sessionId>.jsonl nested under a project dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tl-'))
    dirs.push(root)
    await mkdir(join(root, 'proj-a'), { recursive: true })
    await writeFile(join(root, 'proj-a', 'abc.jsonl'), '{}\n', 'utf8')
    expect(await locateTranscript(root, 'abc')).toBe(join(root, 'proj-a', 'abc.jsonl'))
  })

  it('returns null when absent or when the dir is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tl-'))
    dirs.push(root)
    expect(await locateTranscript(root, 'nope')).toBeNull()
    expect(await locateTranscript(join(root, 'ghost'), 'x')).toBeNull()
  })
})
