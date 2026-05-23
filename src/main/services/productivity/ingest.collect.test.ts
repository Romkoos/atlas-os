import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { turnId } from '@main/services/productivity/ids'
import { collectIngestRows } from '@main/services/productivity/ingest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const CWD = '/work/proj'
const SID = 's-int'

function userPrompt(text: string, ts: string) {
  return JSON.stringify({
    type: 'user',
    sessionId: SID,
    cwd: CWD,
    timestamp: ts,
    isSidechain: false,
    message: { role: 'user', content: text },
  })
}

function assistant(usage: Record<string, number>, content: unknown[], ts: string) {
  return JSON.stringify({
    type: 'assistant',
    sessionId: SID,
    cwd: CWD,
    timestamp: ts,
    isSidechain: false,
    message: { role: 'assistant', usage, content },
  })
}

describe('collectIngestRows', () => {
  let dir: string
  let projectsDir: string
  let bufferDir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'atlas-collect-'))
    projectsDir = join(dir, 'projects')
    bufferDir = join(dir, 'buffer')
    await mkdir(join(projectsDir, 'proj'), { recursive: true })
    await mkdir(bufferDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function writeTranscript(lines: string[]) {
    await writeFile(join(projectsDir, 'proj', `${SID}.jsonl`), `${lines.join('\n')}\n`, 'utf8')
  }

  async function writeBuffer() {
    await writeFile(
      join(bufferDir, 'sessions.jsonl'),
      `${[
        JSON.stringify({
          event: 'session_start',
          session_id: SID,
          project_path: CWD,
          started_at: '2026-05-23T09:00:00Z',
        }),
        JSON.stringify({
          event: 'session_end',
          session_id: SID,
          ended_at: '2026-05-23T10:00:00Z',
          reason: 'other',
        }),
        JSON.stringify({ event: 'session_score', session_id: SID, score: 8, summary: 'done' }),
      ].join('\n')}\n`,
      'utf8',
    )
    await writeFile(
      join(bufferDir, 'ecosystem-changes.jsonl'),
      `${JSON.stringify({ ts: '2026-05-23T08:00:00Z', type: 'config_changed', target: '/x/settings.json', source: 'auto', diff: null, note: null })}\n`,
      'utf8',
    )
  }

  it('builds turn rows, merged session row, and ecosystem rows from disk', async () => {
    await writeTranscript([
      userPrompt('p0', '2026-05-23T09:01:00Z'),
      assistant(
        { input_tokens: 100, output_tokens: 10 },
        [{ type: 'tool_use', name: 'Read' }],
        '2026-05-23T09:01:05Z',
      ),
      userPrompt('p1', '2026-05-23T09:02:00Z'),
      assistant(
        { input_tokens: 50, output_tokens: 5 },
        [{ type: 'text', text: 'ok' }],
        '2026-05-23T09:02:05Z',
      ),
    ])
    await writeBuffer()

    const rows = await collectIngestRows({ projectsDir, bufferDir })

    expect(rows.turnRows).toHaveLength(2)
    expect(rows.turnRows[0].id).toBe(turnId(SID, 0))
    expect(rows.sessionRows).toHaveLength(1)
    expect(rows.sessionRows[0]).toMatchObject({
      sessionId: SID,
      projectPath: CWD,
      score: 8,
      summary: 'done',
      endReason: 'other',
      turnCount: 2,
      totalTokensIn: 150,
      totalTokensOut: 15,
    })
    expect(rows.ecoRows).toHaveLength(1)
    expect(rows.ecoRows[0].type).toBe('config_changed')
  })

  it('produces stable ids across runs (so upserts dedupe)', async () => {
    await writeTranscript([
      userPrompt('p0', '2026-05-23T09:01:00Z'),
      assistant({ input_tokens: 100, output_tokens: 10 }, [], '2026-05-23T09:01:05Z'),
    ])
    await writeBuffer()

    const a = await collectIngestRows({ projectsDir, bufferDir })
    const b = await collectIngestRows({ projectsDir, bufferDir })

    expect(a.turnRows.map((r) => r.id)).toEqual(b.turnRows.map((r) => r.id))
    expect(a.ecoRows.map((r) => r.id)).toEqual(b.ecoRows.map((r) => r.id))
  })

  it('reflects a growing turn with the same id but updated tokens', async () => {
    await writeTranscript([
      userPrompt('p0', '2026-05-23T09:01:00Z'),
      assistant({ input_tokens: 100, output_tokens: 10 }, [], '2026-05-23T09:01:05Z'),
    ])
    const first = await collectIngestRows({ projectsDir, bufferDir })

    await writeTranscript([
      userPrompt('p0', '2026-05-23T09:01:00Z'),
      assistant({ input_tokens: 100, output_tokens: 10 }, [], '2026-05-23T09:01:05Z'),
      assistant({ input_tokens: 70, output_tokens: 7 }, [], '2026-05-23T09:01:08Z'),
    ])
    const second = await collectIngestRows({ projectsDir, bufferDir })

    expect(second.turnRows[0].id).toBe(first.turnRows[0].id)
    expect(first.turnRows[0]).toMatchObject({ tokensIn: 100, tokensOut: 10 })
    expect(second.turnRows[0]).toMatchObject({ tokensIn: 170, tokensOut: 17 })
  })

  it('returns empty rows when nothing exists on disk', async () => {
    const rows = await collectIngestRows({ projectsDir, bufferDir })
    expect(rows).toMatchObject({ turnRows: [], sessionRows: [], ecoRows: [] })
  })
})
