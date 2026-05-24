import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppDatabase } from '@main/db/client'
import type { NewAgentSessionRow, NewAgentTurnRow } from '@main/db/schema'
import { agentSessions, agentTurns, ecosystemChanges } from '@main/db/schema'
import { estimateDifficulty } from '@main/services/productivity/difficulty'
import { turnId } from '@main/services/productivity/ids'
import {
  type EcosystemChange,
  foldSessionEvents,
  parseEcosystemChanges,
  readJsonlFile,
  type SessionBufferRecord,
} from '@main/services/productivity/jsonl'
import {
  type AgentTurn,
  firstUserPrompt,
  parseTranscriptTurns,
} from '@main/services/productivity/transcript'
import { getSettings } from '@main/store'
import { and, eq, isNull } from 'drizzle-orm'

export interface SessionAggregate {
  projectPath: string
  turnCount: number
  totalTokensIn: number
  totalTokensOut: number
  distinctFiles: number
  distinctDirs: number
  distinctTools: number
  distinctSkills: number
  subagentCount: number
}

// Parent dir of a path ("/a/b/c.ts" -> "/a/b"). No node:path needed; assumes non-empty paths.
function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i <= 0 ? '/' : path.slice(0, i)
}

// Per-session rollup of transcript-derived turns, including the five "scope"
// signals used for complexity.
export function aggregateBySession(turns: AgentTurn[]): Map<string, SessionAggregate> {
  interface Acc {
    projectPath: string
    turnCount: number
    totalTokensIn: number
    totalTokensOut: number
    files: Set<string>
    dirs: Set<string>
    tools: Set<string>
    skills: Set<string>
    subagentCount: number
  }
  const agg = new Map<string, Acc>()
  for (const t of turns) {
    let a = agg.get(t.sessionId)
    if (!a) {
      a = {
        projectPath: t.projectPath,
        turnCount: 0,
        totalTokensIn: 0,
        totalTokensOut: 0,
        files: new Set(),
        dirs: new Set(),
        tools: new Set(),
        skills: new Set(),
        subagentCount: 0,
      }
      agg.set(t.sessionId, a)
    }
    a.turnCount++
    a.totalTokensIn += t.tokensIn
    a.totalTokensOut += t.tokensOut
    for (const f of t.filesTouched) {
      a.files.add(f)
      a.dirs.add(dirOf(f))
    }
    for (const tool of t.toolsUsed) a.tools.add(tool)
    for (const s of t.skillsUsed) a.skills.add(s)
    if (t.toolsUsed.includes('Task')) a.subagentCount++
  }
  const out = new Map<string, SessionAggregate>()
  for (const [id, a] of agg) {
    out.set(id, {
      projectPath: a.projectPath,
      turnCount: a.turnCount,
      totalTokensIn: a.totalTokensIn,
      totalTokensOut: a.totalTokensOut,
      distinctFiles: a.files.size,
      distinctDirs: a.dirs.size,
      distinctTools: a.tools.size,
      distinctSkills: a.skills.size,
      subagentCount: a.subagentCount,
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
    filesTouched: t.filesTouched,
  }))
}

// Unions transcript aggregates (token/turn rollups + scope counts) with buffer
// records (lifecycle only). Quality `score` is user-set via the UI, never from
// the buffer/agent self-rating, so it is left untouched here (null on insert).
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
      score: null, // user rating only (set via productivity.setRating); never from buffer
      summary: buf?.summary ?? null,
      totalTokensIn: agg?.totalTokensIn ?? 0,
      totalTokensOut: agg?.totalTokensOut ?? 0,
      turnCount: agg?.turnCount ?? 0,
      avgComplexity: null, // deprecated; complexity computed at read time
      distinctFiles: agg?.distinctFiles ?? 0,
      distinctDirs: agg?.distinctDirs ?? 0,
      distinctTools: agg?.distinctTools ?? 0,
      distinctSkills: agg?.distinctSkills ?? 0,
      subagentCount: agg?.subagentCount ?? 0,
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
  // Original ask per session, used only by the gated LLM difficulty pass. Does
  // not affect any row/count output.
  firstPromptBySession: Map<string, string>
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
  const firstPromptBySession = new Map<string, string>()
  for (const file of transcripts) {
    const lines = await readJsonlFile(file)
    const turns = parseTranscriptTurns(lines)
    allTurns.push(...turns)
    // Associate the original ask with this file's session (the sessionId shared
    // by its turns). Skip empties. Used only by the gated difficulty pass.
    const sessionId = turns[0]?.sessionId
    if (sessionId) {
      const prompt = firstUserPrompt(lines)
      if (prompt) firstPromptBySession.set(sessionId, prompt)
    }
  }

  // 2. Buffer → session lifecycle/score + ecosystem changes.
  const sessionLines = await readJsonlFile(join(paths.bufferDir, 'sessions.jsonl'))
  const ecoLines = await readJsonlFile(join(paths.bufferDir, 'ecosystem-changes.jsonl'))
  const bufferRecords = foldSessionEvents(sessionLines)

  return {
    turnRows: buildTurnRows(allTurns),
    sessionRows: buildSessionRows(aggregateBySession(allTurns), bufferRecords),
    ecoRows: parseEcosystemChanges(ecoLines),
    firstPromptBySession,
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
          filesTouched: row.filesTouched,
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
          summary: row.summary,
          totalTokensIn: row.totalTokensIn,
          totalTokensOut: row.totalTokensOut,
          turnCount: row.turnCount,
          avgComplexity: row.avgComplexity, // always null (deprecated)
          distinctFiles: row.distinctFiles,
          distinctDirs: row.distinctDirs,
          distinctTools: row.distinctTools,
          distinctSkills: row.distinctSkills,
          subagentCount: row.subagentCount,
        },
      })
      .run()
  }

  for (const row of ecoRows) {
    database.insert(ecosystemChanges).values(row).onConflictDoNothing().run()
  }

  return { turns: turnRows.length, sessions: sessionRows.length, ecosystem: ecoRows.length }
}

// Gated LLM pass: fill in `difficulty` for sessions that still lack it, using
// the original ask. No-op unless the user enabled `estimateDifficulty`. Capped
// per run and best-effort (estimateDifficulty never throws) so it can never
// stall or break ingest. Behind the gate so the default path is unchanged.
async function estimateMissingDifficulties(
  database: AppDatabase,
  firstPromptBySession: Map<string, string>,
): Promise<void> {
  if (!getSettings().estimateDifficulty) return
  const missing = database
    .select({ id: agentSessions.sessionId })
    .from(agentSessions)
    .where(isNull(agentSessions.difficulty))
    .all()
  let processed = 0
  for (const { id } of missing) {
    if (processed >= 20) break // safety cap per ingest run (avoid long hangs)
    const prompt = firstPromptBySession.get(id)
    if (!prompt) continue
    const d = await estimateDifficulty(prompt)
    if (d == null) continue
    database
      .update(agentSessions)
      .set({ difficulty: d, difficultySource: 'llm' })
      .where(and(eq(agentSessions.sessionId, id), isNull(agentSessions.difficulty)))
      .run()
    processed++
  }
}

export async function ingestAll(database: AppDatabase, paths: IngestPaths): Promise<IngestResult> {
  const rows = await collectIngestRows(paths)
  const result = writeRows(database, rows)
  await estimateMissingDifficulties(database, rows.firstPromptBySession)
  return result
}
