import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDatabase } from '@main/db/client'
import type { NewAgentSessionRow, NewAgentTurnRow } from '@main/db/schema'
import { agentSessions, agentTurns, ecosystemChanges } from '@main/db/schema'
import { complexityProxy } from '@main/services/productivity/complexity'
import { turnId } from '@main/services/productivity/ids'
import {
  type EcosystemChange,
  foldSessionEvents,
  parseEcosystemChanges,
  readJsonlFile,
  type SessionBufferRecord,
} from '@main/services/productivity/jsonl'
import { type AgentTurn, parseTranscriptTurns } from '@main/services/productivity/transcript'

export interface SessionAggregate {
  projectPath: string
  turnCount: number
  totalTokensIn: number
  totalTokensOut: number
  avgComplexity: number
}

// Per-session rollup of transcript-derived turns.
export function aggregateBySession(turns: AgentTurn[]): Map<string, SessionAggregate> {
  const agg = new Map<string, SessionAggregate & { complexitySum: number }>()
  for (const t of turns) {
    let a = agg.get(t.sessionId)
    if (!a) {
      a = {
        projectPath: t.projectPath,
        turnCount: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        avgComplexity: 0,
        complexitySum: 0,
      }
      agg.set(t.sessionId, a)
    }
    a.turnCount++
    a.totalTokensIn += t.tokensIn
    a.totalTokensOut += t.tokensOut
    a.complexitySum += complexityProxy(t)
  }
  const out = new Map<string, SessionAggregate>()
  for (const [id, a] of agg) {
    out.set(id, {
      projectPath: a.projectPath,
      turnCount: a.turnCount,
      totalTokensIn: a.totalTokensIn,
      totalTokensOut: a.totalTokensOut,
      avgComplexity: a.turnCount > 0 ? a.complexitySum / a.turnCount : 0,
    })
  }
  return out
}

export function buildTurnRows(turns: AgentTurn[]): NewAgentTurnRow[] {
  return turns.map((t) => ({
    id: turnId(t.sessionId, t.turnIndex),
    sessionId: t.sessionId,
    projectPath: t.projectPath,
    turnIndex: t.turnIndex,
    ts: t.ts,
    tokensIn: t.tokensIn,
    tokensOut: t.tokensOut,
    toolsUsed: t.toolsUsed,
    skillsUsed: t.skillsUsed,
    complexityProxy: complexityProxy(t),
  }))
}

// Unions transcript aggregates (token/turn rollups) with buffer records
// (lifecycle + /done score) into one row per session.
export function buildSessionRows(
  aggregates: Map<string, SessionAggregate>,
  bufferRecords: SessionBufferRecord[],
): NewAgentSessionRow[] {
  const bufById = new Map(bufferRecords.map((r) => [r.sessionId, r]))
  const ids = new Set<string>([...aggregates.keys(), ...bufById.keys()])

  const rows: NewAgentSessionRow[] = []
  for (const id of ids) {
    const agg = aggregates.get(id)
    const buf = bufById.get(id)
    rows.push({
      sessionId: id,
      projectPath: agg?.projectPath ?? buf?.projectPath ?? '',
      startedAt: buf?.startedAt ?? null,
      endedAt: buf?.endedAt ?? null,
      endReason: buf?.endReason ?? null,
      score: buf?.score ?? null,
      summary: buf?.summary ?? null,
      totalTokensIn: agg?.totalTokensIn ?? 0,
      totalTokensOut: agg?.totalTokensOut ?? 0,
      turnCount: agg?.turnCount ?? 0,
      avgComplexity: agg ? agg.avgComplexity : null,
    })
  }
  return rows
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export interface IngestPaths {
  projectsDir: string // ~/.claude/projects
  bufferDir: string // ~/agent-analytics
}

export interface IngestResult {
  turns: number
  sessions: number
  ecosystem: number
}

export interface IngestRows {
  turnRows: NewAgentTurnRow[]
  sessionRows: NewAgentSessionRow[]
  ecoRows: EcosystemChange[]
}

async function safeReaddir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function findTranscripts(dir: string): Promise<string[]> {
  const files: string[] = []
  for (const e of await safeReaddir(dir)) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      files.push(...(await findTranscripts(full)))
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      files.push(full)
    }
  }
  return files
}

// Reads transcripts + buffer from disk and builds all rows. Pure of the
// database, so it is testable in plain Node (better-sqlite3 is an Electron-ABI
// native module and cannot load under vitest).
export async function collectIngestRows(paths: IngestPaths): Promise<IngestRows> {
  // 1. Transcripts → turns (source of truth for per-turn metrics).
  const transcripts = await findTranscripts(paths.projectsDir)
  const allTurns: AgentTurn[] = []
  for (const file of transcripts) {
    const lines = await readJsonlFile(file)
    allTurns.push(...parseTranscriptTurns(lines))
  }

  // 2. Buffer → session lifecycle/score + ecosystem changes.
  const sessionLines = await readJsonlFile(join(paths.bufferDir, 'sessions.jsonl'))
  const ecoLines = await readJsonlFile(join(paths.bufferDir, 'ecosystem-changes.jsonl'))
  const bufferRecords = foldSessionEvents(sessionLines)

  return {
    turnRows: buildTurnRows(allTurns),
    sessionRows: buildSessionRows(aggregateBySession(allTurns), bufferRecords),
    ecoRows: parseEcosystemChanges(ecoLines),
  }
}

// Upserts rows. Turns/sessions update in place (the latest turn and the score
// arrive over time); ecosystem rows are immutable (id from content), so a
// repeated change is deduped. Deterministic ids make every write idempotent.
export function writeRows(database: AppDatabase, rows: IngestRows): IngestResult {
  const { turnRows, sessionRows, ecoRows } = rows

  for (const row of turnRows) {
    database
      .insert(agentTurns)
      .values(row)
      .onConflictDoUpdate({
        target: agentTurns.id,
        set: {
          ts: row.ts,
          tokensIn: row.tokensIn,
          tokensOut: row.tokensOut,
          toolsUsed: row.toolsUsed,
          skillsUsed: row.skillsUsed,
          complexityProxy: row.complexityProxy,
        },
      })
      .run()
  }

  for (const row of sessionRows) {
    database
      .insert(agentSessions)
      .values(row)
      .onConflictDoUpdate({
        target: agentSessions.sessionId,
        set: {
          projectPath: row.projectPath,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          endReason: row.endReason,
          score: row.score,
          summary: row.summary,
          totalTokensIn: row.totalTokensIn,
          totalTokensOut: row.totalTokensOut,
          turnCount: row.turnCount,
          avgComplexity: row.avgComplexity,
        },
      })
      .run()
  }

  for (const row of ecoRows) {
    database.insert(ecosystemChanges).values(row).onConflictDoNothing().run()
  }

  return { turns: turnRows.length, sessions: sessionRows.length, ecosystem: ecoRows.length }
}

export async function ingestAll(database: AppDatabase, paths: IngestPaths): Promise<IngestResult> {
  return writeRows(database, await collectIngestRows(paths))
}
