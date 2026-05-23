import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  foldSessionEvents,
  parseEcosystemChanges,
  readJsonlFile,
} from '@main/services/productivity/jsonl'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

describe('foldSessionEvents', () => {
  it('folds start, end and score lines for one session into one record', () => {
    const lines = [
      {
        event: 'session_start',
        session_id: 's1',
        project_path: '/proj',
        started_at: '2026-05-23T09:00:00Z',
      },
      { event: 'session_end', session_id: 's1', ended_at: '2026-05-23T10:00:00Z', reason: 'other' },
      { event: 'session_score', session_id: 's1', score: 8, summary: 'did stuff' },
    ]

    const recs = foldSessionEvents(lines)

    expect(recs).toHaveLength(1)
    expect(recs[0]).toMatchObject({
      sessionId: 's1',
      projectPath: '/proj',
      endReason: 'other',
      score: 8,
      summary: 'did stuff',
    })
    expect(recs[0].startedAt).toEqual(new Date('2026-05-23T09:00:00Z'))
    expect(recs[0].endedAt).toEqual(new Date('2026-05-23T10:00:00Z'))
  })

  it('keeps separate records per session_id', () => {
    const recs = foldSessionEvents([
      {
        event: 'session_start',
        session_id: 's1',
        project_path: '/a',
        started_at: '2026-05-23T09:00:00Z',
      },
      {
        event: 'session_start',
        session_id: 's2',
        project_path: '/b',
        started_at: '2026-05-23T09:05:00Z',
      },
    ])
    expect(recs.map((r) => r.sessionId).sort()).toEqual(['s1', 's2'])
  })

  it('applies last-write-wins for a repeated field', () => {
    const recs = foldSessionEvents([
      { event: 'session_score', session_id: 's1', score: 5, summary: 'first' },
      { event: 'session_score', session_id: 's1', score: 9, summary: 'second' },
    ])
    expect(recs[0]).toMatchObject({ score: 9, summary: 'second' })
  })

  it('ignores malformed lines (no session_id or unknown event)', () => {
    const recs = foldSessionEvents([
      {
        event: 'session_start',
        session_id: 's1',
        project_path: '/a',
        started_at: '2026-05-23T09:00:00Z',
      },
      { event: 'bogus', session_id: 's1' },
      { nonsense: true },
      null,
    ])
    expect(recs).toHaveLength(1)
    expect(recs[0].sessionId).toBe('s1')
  })
})

describe('parseEcosystemChanges', () => {
  it('maps fields and assigns a deterministic id', () => {
    const lines = [
      {
        ts: '2026-05-23T08:00:00Z',
        type: 'config_changed',
        target: '/x/settings.json',
        source: 'auto',
        diff: null,
        note: null,
      },
    ]
    const out = parseEcosystemChanges(lines)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: 'config_changed',
      target: '/x/settings.json',
      source: 'auto',
    })
    expect(out[0].ts).toEqual(new Date('2026-05-23T08:00:00Z'))
    expect(out[0].id).toBe(parseEcosystemChanges(lines)[0].id) // stable
  })

  it('skips lines missing ts or type', () => {
    const out = parseEcosystemChanges([
      { type: 'config_changed' },
      { ts: '2026-05-23T08:00:00Z' },
      {
        ts: '2026-05-23T08:00:00Z',
        type: 'skill_edited',
        target: '/s',
        source: 'auto',
        diff: null,
        note: null,
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('skill_edited')
  })
})

describe('readJsonlFile', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'atlas-jsonl-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('parses each line and skips blank or corrupt lines', async () => {
    const file = join(dir, 'data.jsonl')
    await writeFile(file, '{"a":1}\n\n  \nnot json\n{"a":2}\n', 'utf8')
    const out = await readJsonlFile(file)
    expect(out).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('returns [] for a missing file', async () => {
    const out = await readJsonlFile(join(dir, 'nope.jsonl'))
    expect(out).toEqual([])
  })
})
