import { basename } from 'node:path'
import { db } from '@main/db/client'
import { agentSessions, agentTurns, ecosystemChanges } from '@main/db/schema'
import { appPaths } from '@main/paths'
import { complexityFromPercentiles, percentileRanks } from '@main/services/productivity/complexity'
import { ecosystemId } from '@main/services/productivity/ids'
import { ingestAll } from '@main/services/productivity/ingest'
import { getSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import { type KpiInput, type KpiSession, kpiByDay, kpiWindow } from '@shared/kpi'
import { and, avg, count, countDistinct, desc, eq, gte, inArray, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'

const cutoffDate = (days: number): Date => new Date(Date.now() - days * 24 * 60 * 60 * 1000)
const toNum = (v: string | number | null): number | null => (v == null ? null : Number(v))

// Shared input: a time window (in days) and an optional project filter.
const rangeInput = z
  .object({
    days: z.number().int().positive().default(30),
    projectPath: z.string().optional(),
  })
  .default({ days: 30 })

const trackedProjects = (): string[] => getSettings().trackedProjects ?? []

// Restrict to the tracked-project allowlist (empty = track all). Ignores any
// single-project selection — used for cross-project views (byProject, dropdown).
const trackedCondition = (): SQL | undefined => {
  const tracked = trackedProjects()
  return tracked.length ? inArray(agentTurns.projectPath, tracked) : undefined
}

// Project scope for a scoped query: an explicit project wins; otherwise fall
// back to the tracked allowlist.
const projectCondition = (projectPath?: string): SQL | undefined =>
  projectPath ? eq(agentTurns.projectPath, projectPath) : trackedCondition()

// Sessions are windowed by turn activity (agent_turns.ts), not by started_at —
// started_at comes only from the SessionStart hook and may be null, so keying
// on it would hide every session when hooks aren't installed.
const turnFilter = (cutoff: Date, projectPath?: string): SQL | undefined =>
  and(gte(agentTurns.ts, cutoff), projectCondition(projectPath))

interface SessionComplexity {
  complexity: number // 1..10
  distinctFiles: number
  distinctDirs: number
  distinctTools: number
  distinctSkills: number
  subagentCount: number
}

// Complexity = percentile-composite of five scope counts across the whole
// (tracked) session corpus. Computed at read time so it never goes stale.
function sessionComplexityMap(): Map<string, SessionComplexity> {
  const tracked = trackedProjects()
  const rows = db()
    .select({
      sessionId: agentSessions.sessionId,
      distinctFiles: agentSessions.distinctFiles,
      distinctDirs: agentSessions.distinctDirs,
      distinctTools: agentSessions.distinctTools,
      distinctSkills: agentSessions.distinctSkills,
      subagentCount: agentSessions.subagentCount,
    })
    .from(agentSessions)
    .where(tracked.length ? inArray(agentSessions.projectPath, tracked) : undefined)
    .all()

  const pFiles = percentileRanks(rows.map((r) => r.distinctFiles))
  const pDirs = percentileRanks(rows.map((r) => r.distinctDirs))
  const pTools = percentileRanks(rows.map((r) => r.distinctTools))
  const pSkills = percentileRanks(rows.map((r) => r.distinctSkills))
  const pSub = percentileRanks(rows.map((r) => r.subagentCount))

  const map = new Map<string, SessionComplexity>()
  rows.forEach((r, i) => {
    map.set(r.sessionId, {
      complexity: complexityFromPercentiles([pFiles[i], pDirs[i], pTools[i], pSkills[i], pSub[i]]),
      distinctFiles: r.distinctFiles,
      distinctDirs: r.distinctDirs,
      distinctTools: r.distinctTools,
      distinctSkills: r.distinctSkills,
      subagentCount: r.subagentCount,
    })
  })
  return map
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length

export const productivityRouter = router({
  // Re-scan transcripts + JSONL buffer and upsert into the DB.
  refresh: publicProcedure
    .output(z.object({ turns: z.number(), sessions: z.number(), ecosystem: z.number() }))
    .mutation(async () => {
      const { claudeProjectsDir, analyticsBufferDir } = appPaths()
      return await ingestAll(db(), {
        projectsDir: claudeProjectsDir,
        bufferDir: analyticsBufferDir,
      })
    }),

  // Tracked projects for the page filter dropdown (all-time, stable across the
  // selected window). Respects the tracked-project allowlist.
  projects: publicProcedure
    .output(z.array(z.object({ projectPath: z.string(), project: z.string() })))
    .query(() => {
      const rows = db()
        .selectDistinct({ projectPath: agentTurns.projectPath })
        .from(agentTurns)
        .where(trackedCondition())
        .all()
      return rows
        .map((r) => ({
          projectPath: r.projectPath,
          project: basename(r.projectPath) || r.projectPath,
        }))
        .sort((a, b) => a.project.localeCompare(b.project))
    }),

  // Every discoverable project (ignores the allowlist) + whether it is tracked.
  // Powers the tracked-project picker in Settings.
  discoverProjects: publicProcedure
    .output(
      z.array(z.object({ projectPath: z.string(), project: z.string(), tracked: z.boolean() })),
    )
    .query(() => {
      const tracked = new Set(trackedProjects())
      const rows = db()
        .selectDistinct({ projectPath: agentTurns.projectPath })
        .from(agentTurns)
        .all()
      return rows
        .map((r) => ({
          projectPath: r.projectPath,
          project: basename(r.projectPath) || r.projectPath,
          tracked: tracked.size === 0 || tracked.has(r.projectPath),
        }))
        .sort((a, b) => a.project.localeCompare(b.project))
    }),

  // Overview scoped by window + optional project. byProject is always the
  // cross-project comparison over the window (ignores the project filter).
  overview: publicProcedure
    .input(rangeInput)
    .output(
      z.object({
        tokensByDay: z.array(
          z.object({ date: z.string(), tokensIn: z.number(), tokensOut: z.number() }),
        ),
        totals: z.object({
          totalTokens: z.number(),
          turns: z.number(),
          sessions: z.number(),
          avgScore: z.number().nullable(),
          ratedCount: z.number(),
          totalCount: z.number(),
          avgComplexity: z.number().nullable(),
        }),
        byProject: z.array(
          z.object({
            projectPath: z.string(),
            project: z.string(),
            totalTokens: z.number(),
            turns: z.number(),
            sessions: z.number(),
            avgComplexity: z.number().nullable(),
          }),
        ),
      }),
    )
    .query(({ input }) => {
      const cutoff = cutoffDate(input.days)
      const scoped = turnFilter(cutoff, input.projectPath)

      const day = sql<string>`date(${agentTurns.ts} / 1000, 'unixepoch', 'localtime')`
      const tokensByDay = db()
        .select({
          date: day,
          tokensIn: sql<number>`coalesce(sum(${agentTurns.tokensIn}), 0)`,
          tokensOut: sql<number>`coalesce(sum(${agentTurns.tokensOut}), 0)`,
        })
        .from(agentTurns)
        .where(scoped)
        .groupBy(day)
        .orderBy(day)
        .all()

      const totals = db()
        .select({
          totalTokens: sql<number>`coalesce(sum(${agentTurns.tokensIn} + ${agentTurns.tokensOut}), 0)`,
          turns: count(),
          sessions: countDistinct(agentTurns.sessionId),
        })
        .from(agentTurns)
        .where(scoped)
        .get()

      // avgScore from the sessions that were active in the window.
      const windowSessionIds = db()
        .select({ id: agentTurns.sessionId })
        .from(agentTurns)
        .where(scoped)
      const scoreRow = db()
        .select({
          avgScore: avg(agentSessions.score),
          ratedCount: sql<number>`count(${agentSessions.score})`, // counts non-null only
          totalCount: count(),
        })
        .from(agentSessions)
        .where(inArray(agentSessions.sessionId, windowSessionIds))
        .get()

      const byProject = db()
        .select({
          projectPath: agentTurns.projectPath,
          totalTokens: sql<number>`coalesce(sum(${agentTurns.tokensIn} + ${agentTurns.tokensOut}), 0)`,
          turns: count(),
          sessions: countDistinct(agentTurns.sessionId),
        })
        .from(agentTurns)
        .where(and(gte(agentTurns.ts, cutoff), trackedCondition()))
        .groupBy(agentTurns.projectPath)
        .all()

      // Complexity aggregates computed at read time from the session corpus.
      const cmap = sessionComplexityMap()
      const windowIdSet = new Set(
        db()
          .select({ id: agentTurns.sessionId })
          .from(agentTurns)
          .where(scoped)
          .all()
          .map((r) => r.id),
      )
      const avgComplexity = mean(
        [...windowIdSet]
          .map((id) => cmap.get(id)?.complexity)
          .filter((c): c is number => c != null),
      )

      // Per-project complexity over the window. Restrict to tracked sessions so
      // the project lookup matches sessionComplexityMap's corpus.
      const projComplexity = new Map<string, number[]>()
      const tracked = trackedProjects()
      const projOfSession = db()
        .select({ id: agentSessions.sessionId, project: agentSessions.projectPath })
        .from(agentSessions)
        .where(tracked.length ? inArray(agentSessions.projectPath, tracked) : undefined)
        .all()
      const projById = new Map(projOfSession.map((r) => [r.id, r.project]))
      for (const id of windowIdSet) {
        const c = cmap.get(id)?.complexity
        const p = projById.get(id)
        if (c == null || p == null) continue
        const arr = projComplexity.get(p) ?? []
        arr.push(c)
        projComplexity.set(p, arr)
      }

      return {
        tokensByDay,
        totals: {
          totalTokens: Number(totals?.totalTokens ?? 0),
          turns: totals?.turns ?? 0,
          sessions: totals?.sessions ?? 0,
          avgScore: toNum(scoreRow?.avgScore ?? null),
          ratedCount: scoreRow?.ratedCount ?? 0,
          totalCount: scoreRow?.totalCount ?? 0,
          avgComplexity,
        },
        byProject: byProject
          .map((p) => ({
            projectPath: p.projectPath,
            project: basename(p.projectPath) || p.projectPath,
            totalTokens: Number(p.totalTokens),
            turns: p.turns,
            sessions: p.sessions,
            avgComplexity: mean(projComplexity.get(p.projectPath) ?? []),
          }))
          .sort((a, b) => b.totalTokens - a.totalTokens),
      }
    }),

  // Efficiency KPI per day + overall, scoped by window + optional project.
  // KPI = (score ?? 5.5) × complexity / (tokens / 1M), token-weighted per day.
  // Each session is bucketed on its last-turn local day so day keys align with
  // tokensByDay / ecosystemDays (the EcoMarkers overlay relies on that).
  kpi: publicProcedure
    .input(rangeInput)
    .output(
      z.object({
        byDay: z.array(
          z.object({
            date: z.string(),
            kpi: z.number(),
            sessions: z.number(),
            tokens: z.number(),
          }),
        ),
        overall: z.number().nullable(),
      }),
    )
    .query(({ input }) => {
      const scoped = turnFilter(cutoffDate(input.days), input.projectPath)

      // Each session's last-turn local day, within window + scope.
      const day = sql<string>`date(max(${agentTurns.ts}) / 1000, 'unixepoch', 'localtime')`
      const dayRows = db()
        .select({ id: agentTurns.sessionId, day })
        .from(agentTurns)
        .where(scoped)
        .groupBy(agentTurns.sessionId)
        .all()
      if (dayRows.length === 0) return { byDay: [], overall: null }
      const dayById = new Map(dayRows.map((r) => [r.id, r.day]))

      const ids = dayRows.map((r) => r.id)
      const sessRows = db()
        .select({
          id: agentSessions.sessionId,
          score: agentSessions.score,
          tin: agentSessions.totalTokensIn,
          tout: agentSessions.totalTokensOut,
        })
        .from(agentSessions)
        .where(inArray(agentSessions.sessionId, ids))
        .all()

      const cmap = sessionComplexityMap()
      const sessions: KpiSession[] = sessRows.flatMap((r) => {
        const day = dayById.get(r.id)
        if (!day) return []
        return [
          {
            day,
            score: r.score,
            complexity: cmap.get(r.id)?.complexity ?? null,
            tokens: r.tin + r.tout,
          },
        ]
      })

      return { byDay: kpiByDay(sessions), overall: kpiWindow(sessions) }
    }),

  // Current local calendar day broken down by hour (0–23). Always "today",
  // independent of the page range toggle. Respects the project/tracked scope.
  today: publicProcedure
    .input(z.object({ projectPath: z.string().optional() }).default({}))
    .output(
      z.object({
        hours: z.array(
          z.object({
            hour: z.string(),
            tokensIn: z.number(),
            tokensOut: z.number(),
            turns: z.number(),
          }),
        ),
        totals: z.object({
          totalTokens: z.number(),
          turns: z.number(),
          sessions: z.number(),
          activeHours: z.number(),
        }),
      }),
    )
    .query(({ input }) => {
      const isToday = sql`date(${agentTurns.ts} / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')`
      const scoped = and(isToday, projectCondition(input.projectPath))
      const hour = sql<string>`strftime('%H', ${agentTurns.ts} / 1000, 'unixepoch', 'localtime')`

      const byHour = db()
        .select({
          hour,
          tokensIn: sql<number>`coalesce(sum(${agentTurns.tokensIn}), 0)`,
          tokensOut: sql<number>`coalesce(sum(${agentTurns.tokensOut}), 0)`,
          turns: count(),
        })
        .from(agentTurns)
        .where(scoped)
        .groupBy(hour)
        .all()

      const totals = db()
        .select({
          totalTokens: sql<number>`coalesce(sum(${agentTurns.tokensIn} + ${agentTurns.tokensOut}), 0)`,
          turns: count(),
          sessions: countDistinct(agentTurns.sessionId),
        })
        .from(agentTurns)
        .where(scoped)
        .get()

      // Fill 0–23 so the chart draws a full-day axis with idle hours as zeros.
      const map = new Map(byHour.map((r) => [r.hour, r]))
      const hours = Array.from({ length: 24 }, (_, h) => {
        const key = String(h).padStart(2, '0')
        const row = map.get(key)
        return {
          hour: key,
          tokensIn: Number(row?.tokensIn ?? 0),
          tokensOut: Number(row?.tokensOut ?? 0),
          turns: row?.turns ?? 0,
        }
      })

      return {
        hours,
        totals: {
          totalTokens: Number(totals?.totalTokens ?? 0),
          turns: totals?.turns ?? 0,
          sessions: totals?.sessions ?? 0,
          activeHours: byHour.length,
        },
      }
    }),

  // Session list, newest first, windowed by turn activity + optional project.
  sessions: publicProcedure
    .input(rangeInput)
    .output(
      z.array(
        z.object({
          sessionId: z.string(),
          project: z.string(),
          projectPath: z.string(),
          startedAt: z.date().nullable(),
          endedAt: z.date().nullable(),
          score: z.number().nullable(),
          summary: z.string().nullable(),
          turnCount: z.number(),
          totalTokens: z.number(),
          complexity: z.number().nullable(),
          distinctFiles: z.number(),
          distinctDirs: z.number(),
          distinctTools: z.number(),
          distinctSkills: z.number(),
          subagentCount: z.number(),
        }),
      ),
    )
    .query(({ input }) => {
      const filter = turnFilter(cutoffDate(input.days), input.projectPath)
      const windowSessionIds = db()
        .select({ id: agentTurns.sessionId })
        .from(agentTurns)
        .where(filter)

      // Buffer started_at/ended_at are unreliable (commonly null), so derive each
      // session's real activity window from its turn timestamps and order by last
      // activity — that is the meaningful "newest first" signal.
      const activity = db()
        .select({
          id: agentTurns.sessionId,
          first: sql<number>`min(${agentTurns.ts})`,
          last: sql<number>`max(${agentTurns.ts})`,
        })
        .from(agentTurns)
        .where(filter)
        .groupBy(agentTurns.sessionId)
        .all()
      const firstById = new Map(activity.map((a) => [a.id, a.first]))
      const lastById = new Map(activity.map((a) => [a.id, a.last]))

      const rows = db()
        .select()
        .from(agentSessions)
        .where(inArray(agentSessions.sessionId, windowSessionIds))
        .all()

      const cmap = sessionComplexityMap()
      const recency = (r: (typeof rows)[number]): number =>
        lastById.get(r.sessionId) ?? r.endedAt?.getTime() ?? r.startedAt?.getTime() ?? 0

      return [...rows]
        .sort((a, b) => recency(b) - recency(a))
        .map((r) => {
          const c = cmap.get(r.sessionId)
          const firstTs = firstById.get(r.sessionId)
          const lastTs = lastById.get(r.sessionId)
          return {
            sessionId: r.sessionId,
            project: basename(r.projectPath) || r.projectPath,
            projectPath: r.projectPath,
            startedAt: r.startedAt ?? (firstTs != null ? new Date(firstTs) : null),
            endedAt: r.endedAt ?? (lastTs != null ? new Date(lastTs) : null),
            score: r.score,
            summary: r.summary,
            turnCount: r.turnCount,
            totalTokens: r.totalTokensIn + r.totalTokensOut,
            complexity: c?.complexity ?? null,
            distinctFiles: c?.distinctFiles ?? 0,
            distinctDirs: c?.distinctDirs ?? 0,
            distinctTools: c?.distinctTools ?? 0,
            distinctSkills: c?.distinctSkills ?? 0,
            subagentCount: c?.subagentCount ?? 0,
          }
        })
    }),

  // Tool / skill usage frequency (turns that used each), windowed + per project.
  toolSkillUsage: publicProcedure
    .input(rangeInput)
    .output(
      z.object({
        tools: z.array(z.object({ name: z.string(), count: z.number() })),
        skills: z.array(z.object({ name: z.string(), count: z.number() })),
      }),
    )
    .query(({ input }) => {
      const rows = db()
        .select({ tools: agentTurns.toolsUsed, skills: agentTurns.skillsUsed })
        .from(agentTurns)
        .where(turnFilter(cutoffDate(input.days), input.projectPath))
        .all()

      const tally = (lists: (string[] | null)[]): { name: string; count: number }[] => {
        const counts = new Map<string, number>()
        for (const list of lists) {
          for (const name of list ?? []) counts.set(name, (counts.get(name) ?? 0) + 1)
        }
        return [...counts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      }

      return {
        tools: tally(rows.map((r) => r.tools)),
        skills: tally(rows.map((r) => r.skills)),
      }
    }),

  // Tool / skill co-occurrence: how often two appear together in the same turn.
  // Counts unordered pairs per turn, windowed + per project.
  coOccurrence: publicProcedure
    .input(rangeInput)
    .output(
      z.object({
        toolPairs: z.array(z.object({ name: z.string(), count: z.number() })),
        skillPairs: z.array(z.object({ name: z.string(), count: z.number() })),
      }),
    )
    .query(({ input }) => {
      const rows = db()
        .select({ tools: agentTurns.toolsUsed, skills: agentTurns.skillsUsed })
        .from(agentTurns)
        .where(turnFilter(cutoffDate(input.days), input.projectPath))
        .all()

      const pairs = (lists: (string[] | null)[]): { name: string; count: number }[] => {
        const counts = new Map<string, number>()
        for (const list of lists) {
          const uniq = [...new Set(list ?? [])].sort()
          for (let i = 0; i < uniq.length; i++) {
            for (let j = i + 1; j < uniq.length; j++) {
              const key = `${uniq[i]} + ${uniq[j]}`
              counts.set(key, (counts.get(key) ?? 0) + 1)
            }
          }
        }
        return [...counts.entries()]
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count)
      }

      return {
        toolPairs: pairs(rows.map((r) => r.tools)),
        skillPairs: pairs(rows.map((r) => r.skills)),
      }
    }),

  // Ecosystem-change days within the window (global), for overlaying reference
  // lines on the daily charts. Date keys match overview.tokensByDay. `label`
  // summarizes that day's changes for the chart tooltip.
  ecosystemDays: publicProcedure
    .input(z.object({ days: z.number().int().positive().default(30) }).default({ days: 30 }))
    .output(
      z.array(
        z.object({
          date: z.string(),
          count: z.number(),
          types: z.array(z.string()),
          label: z.string(),
        }),
      ),
    )
    .query(({ input }) => {
      const day = sql<string>`date(${ecosystemChanges.ts} / 1000, 'unixepoch', 'localtime')`
      const rows = db()
        .select({
          date: day,
          type: ecosystemChanges.type,
          target: ecosystemChanges.target,
          note: ecosystemChanges.note,
        })
        .from(ecosystemChanges)
        .where(gte(ecosystemChanges.ts, cutoffDate(input.days)))
        .all()

      const m = new Map<string, { count: number; types: Set<string>; parts: string[] }>()
      for (const r of rows) {
        const e = m.get(r.date) ?? { count: 0, types: new Set<string>(), parts: [] }
        e.count++
        e.types.add(r.type)
        e.parts.push(r.target ?? r.note ?? r.type.replace(/_/g, ' '))
        m.set(r.date, e)
      }
      const cap = (s: string): string => (s.length > 80 ? `${s.slice(0, 79)}…` : s)
      return [...m.entries()]
        .map(([date, e]) => ({
          date,
          count: e.count,
          types: [...e.types],
          label: cap([...new Set(e.parts)].join(', ')),
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
    }),

  // Before/after impact of each ecosystem change: avg tokens-per-turn in the
  // `window` days before vs after the change. The core thesis metric — does a
  // skill/MCP/config edit move token efficiency? Global, respects the allowlist.
  ecosystemImpact: publicProcedure
    .input(z.object({ window: z.number().int().positive().default(7) }).default({ window: 7 }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          ts: z.date(),
          type: z.string(),
          target: z.string().nullable(),
          turnsBefore: z.number(),
          turnsAfter: z.number(),
          tokPerTurnBefore: z.number().nullable(),
          tokPerTurnAfter: z.number().nullable(),
          deltaPct: z.number().nullable(),
          kpiBefore: z.number().nullable(),
          kpiAfter: z.number().nullable(),
          kpiDeltaPct: z.number().nullable(),
        }),
      ),
    )
    .query(({ input }) => {
      const w = input.window * 24 * 60 * 60 * 1000
      // Bound the change list to the last 60 days so the table stays digestible.
      const changes = db()
        .select()
        .from(ecosystemChanges)
        .where(gte(ecosystemChanges.ts, cutoffDate(60)))
        .orderBy(desc(ecosystemChanges.ts))
        .all()
      if (changes.length === 0) return []

      // Load every turn that could fall in any before/after window in one pass,
      // then bucket in JS (variable per-change windows don't group well in SQL).
      const earliest = Math.min(...changes.map((c) => c.ts.getTime())) - w
      const turns = db()
        .select({ ts: agentTurns.ts, tin: agentTurns.tokensIn, tout: agentTurns.tokensOut })
        .from(agentTurns)
        .where(and(gte(agentTurns.ts, new Date(earliest)), trackedCondition()))
        .all()

      // Sessions for KPI before/after: last-turn ms + score/complexity/tokens,
      // bounded by the same `earliest` as the turn pass.
      const sessLast = db()
        .select({ id: agentTurns.sessionId, last: sql<number>`max(${agentTurns.ts})` })
        .from(agentTurns)
        .where(and(gte(agentTurns.ts, new Date(earliest)), trackedCondition()))
        .groupBy(agentTurns.sessionId)
        .all()
      const sessMeta = db()
        .select({
          id: agentSessions.sessionId,
          score: agentSessions.score,
          tin: agentSessions.totalTokensIn,
          tout: agentSessions.totalTokensOut,
        })
        .from(agentSessions)
        .where(
          inArray(
            agentSessions.sessionId,
            sessLast.map((s) => s.id),
          ),
        )
        .all()
      const cmap = sessionComplexityMap()
      const metaById = new Map(sessMeta.map((m) => [m.id, m]))
      const kpiSessions = sessLast.map((s) => {
        const m = metaById.get(s.id)
        return {
          last: s.last,
          score: m?.score ?? null,
          complexity: cmap.get(s.id)?.complexity ?? null,
          tokens: (m?.tin ?? 0) + (m?.tout ?? 0),
        }
      })

      return changes.map((c) => {
        const t = c.ts.getTime()
        let nb = 0
        let sb = 0
        let na = 0
        let sa = 0
        for (const x of turns) {
          const xt = x.ts.getTime()
          if (xt >= t - w && xt < t) {
            nb++
            sb += x.tin + x.tout
          } else if (xt >= t && xt < t + w) {
            na++
            sa += x.tin + x.tout
          }
        }
        const before = nb ? sb / nb : null
        const after = na ? sa / na : null
        const deltaPct = before != null && after != null ? ((after - before) / before) * 100 : null
        const kb: KpiInput[] = []
        const ka: KpiInput[] = []
        for (const s of kpiSessions) {
          if (s.last >= t - w && s.last < t) kb.push(s)
          else if (s.last >= t && s.last < t + w) ka.push(s)
        }
        const kpiBefore = kpiWindow(kb)
        const kpiAfter = kpiWindow(ka)
        const kpiDeltaPct =
          kpiBefore != null && kpiAfter != null && kpiBefore !== 0
            ? ((kpiAfter - kpiBefore) / kpiBefore) * 100
            : null
        return {
          id: c.id,
          ts: c.ts,
          type: c.type,
          target: c.target,
          turnsBefore: nb,
          turnsAfter: na,
          tokPerTurnBefore: before,
          tokPerTurnAfter: after,
          deltaPct,
          kpiBefore,
          kpiAfter,
          kpiDeltaPct,
        }
      })
    }),

  // Ecosystem change timeline (global — settings/skill edits aren't per-project).
  ecosystem: publicProcedure
    .input(z.object({ days: z.number().int().positive().default(90) }).default({ days: 90 }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          ts: z.date(),
          type: z.string(),
          target: z.string().nullable(),
          source: z.string().nullable(),
          note: z.string().nullable(),
        }),
      ),
    )
    .query(({ input }) => {
      const rows = db()
        .select()
        .from(ecosystemChanges)
        .where(gte(ecosystemChanges.ts, cutoffDate(input.days)))
        .orderBy(desc(ecosystemChanges.ts))
        .all()

      return rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        type: r.type,
        target: r.target,
        source: r.source,
        note: r.note,
      }))
    }),

  // Set/clear the user quality rating (1–10) for a session. Quality is
  // user-only; null clears it (falls back to the imputed default in the UI).
  setRating: publicProcedure
    .input(
      z.object({ sessionId: z.string().min(1), score: z.number().int().min(1).max(10).nullable() }),
    )
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      db()
        .update(agentSessions)
        .set({ score: input.score })
        .where(eq(agentSessions.sessionId, input.sessionId))
        .run()
      return { ok: true }
    }),

  // Add a manual annotation to the ecosystem timeline.
  addNote: publicProcedure
    .input(z.object({ ts: z.date(), note: z.string().min(1) }))
    .output(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const id = ecosystemId(input.ts.toISOString(), 'manual_note', null, input.note)
      db()
        .insert(ecosystemChanges)
        .values({
          id,
          ts: input.ts,
          type: 'manual_note',
          target: null,
          source: 'manual',
          diff: null,
          note: input.note,
        })
        .onConflictDoNothing()
        .run()
      return { id }
    }),
})
