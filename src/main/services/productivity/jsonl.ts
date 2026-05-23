import { readFile } from 'node:fs/promises'
import { ecosystemId } from '@main/services/productivity/ids'

// Reads the append-only JSONL buffer written by the Claude Code hooks
// (~/agent-analytics/*.jsonl). The transcript is the source of truth for
// per-turn metrics; this buffer carries session lifecycle, /done scores, and
// ecosystem changes. See docs/agent-productivity-tracker.md.

export interface SessionBufferRecord {
  sessionId: string
  projectPath?: string
  startedAt?: Date
  endedAt?: Date
  endReason?: string
  score?: number
  summary?: string
}

export interface EcosystemChange {
  id: string
  ts: Date
  type: string
  target: string | null
  source: string | null
  diff: string | null
  note: string | null
}

// Reads a JSONL file into parsed objects, skipping blank and corrupt lines.
// A missing file yields an empty array.
export async function readJsonlFile(path: string): Promise<unknown[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return []
  }
  const out: unknown[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      // skip corrupt line
    }
  }
  return out
}

// Folds session_start / session_end / session_score lines (keyed by
// session_id) into one record per session, last-write-wins per field.
export function foldSessionEvents(lines: unknown[]): SessionBufferRecord[] {
  const byId = new Map<string, SessionBufferRecord>()

  const get = (id: string): SessionBufferRecord => {
    let rec = byId.get(id)
    if (!rec) {
      rec = { sessionId: id }
      byId.set(id, rec)
    }
    return rec
  }

  for (const raw of lines) {
    const line = raw as {
      event?: string
      session_id?: string
      project_path?: string
      started_at?: string
      ended_at?: string
      reason?: string
      score?: number
      summary?: string
    }
    const id = line?.session_id
    if (!id) continue

    switch (line.event) {
      case 'session_start': {
        const rec = get(id)
        if (line.project_path != null) rec.projectPath = line.project_path
        if (line.started_at != null) rec.startedAt = new Date(line.started_at)
        break
      }
      case 'session_end': {
        const rec = get(id)
        if (line.ended_at != null) rec.endedAt = new Date(line.ended_at)
        if (line.reason != null) rec.endReason = line.reason
        break
      }
      case 'session_score': {
        const rec = get(id)
        if (line.score != null) rec.score = line.score
        if (line.summary != null) rec.summary = line.summary
        break
      }
      default:
        break // unknown event
    }
  }

  return [...byId.values()]
}

// Maps ecosystem-changes lines to rows, assigning a deterministic id from the
// change content. Lines missing ts or type are skipped.
export function parseEcosystemChanges(lines: unknown[]): EcosystemChange[] {
  const out: EcosystemChange[] = []
  for (const raw of lines) {
    const line = raw as {
      ts?: string
      type?: string
      target?: string | null
      source?: string | null
      diff?: string | null
      note?: string | null
    }
    if (!line?.ts || !line?.type) continue
    out.push({
      id: ecosystemId(line.ts, line.type, line.target ?? null, line.diff ?? null),
      ts: new Date(line.ts),
      type: line.type,
      target: line.target ?? null,
      source: line.source ?? null,
      diff: line.diff ?? null,
      note: line.note ?? null,
    })
  }
  return out
}
