// Parses Claude Code transcript lines (~/.claude/projects/**/*.jsonl) into
// per-turn productivity metrics. The transcript is the source of truth for
// tokens, tools, and skills. See docs/agent-productivity-tracker.md.

export interface AgentTurn {
  sessionId: string
  projectPath: string
  turnIndex: number
  ts: Date
  tokensIn: number
  tokensOut: number
  toolsUsed: string[]
  skillsUsed: string[]
  filesTouched: string[]
}

// A "real" user prompt starts a new turn. Tool results also arrive as `user`
// lines but carry tool_result blocks — they continue the current turn.
function isRealUserPrompt(line: { type?: string; message?: { content?: unknown } }): boolean {
  if (line?.type !== 'user') return false
  const content = line.message?.content
  if (typeof content === 'string') return true
  if (Array.isArray(content)) {
    const hasToolResult = content.some((b) => (b as { type?: string })?.type === 'tool_result')
    const hasText = content.some((b) => (b as { type?: string })?.type === 'text')
    return hasText && !hasToolResult
  }
  return false
}

export function parseTranscriptTurns(lines: unknown[]): AgentTurn[] {
  // turn_index advances per real user prompt and is independent of whether a
  // reply has arrived yet — so re-ingesting a growing transcript keeps indices
  // (and thus turn ids) stable. Turns with no assistant reply are dropped.
  const candidates: { turn: AgentTurn; assistantCount: number }[] = []
  let current: { turn: AgentTurn; assistantCount: number } | null = null
  let turnIndex = 0

  for (const raw of lines) {
    const line = raw as {
      type?: string
      sessionId?: string
      cwd?: string
      timestamp?: string
      isSidechain?: boolean
      message?: { content?: unknown; usage?: Record<string, number> }
    }

    if (line?.isSidechain === true) continue // subagent — tracked separately

    if (isRealUserPrompt(line)) {
      current = {
        turn: {
          sessionId: line.sessionId ?? '',
          projectPath: line.cwd ?? '',
          turnIndex: turnIndex++,
          ts: new Date(line.timestamp ?? 0),
          tokensIn: 0,
          tokensOut: 0,
          toolsUsed: [],
          skillsUsed: [],
          filesTouched: [],
        },
        assistantCount: 0,
      }
      candidates.push(current)
    } else if (line?.type === 'assistant' && current) {
      current.assistantCount++
      const turn = current.turn
      const u = line.message?.usage ?? {}
      // Fresh input the model had to process this step: new tokens + tokens
      // written to cache. cache_read (cheap re-reads of already-cached context)
      // is excluded — summed across an agentic loop it dwarfs everything and
      // makes the number meaningless.
      turn.tokensIn += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
      turn.tokensOut += u.output_tokens ?? 0

      const content = line.message?.content
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as {
            type?: string
            name?: string
            input?: { skill?: string; file_path?: string; notebook_path?: string }
          }
          if (b?.type !== 'tool_use') continue
          if (b.name === 'Skill') {
            const skill = b.input?.skill
            if (skill && !turn.skillsUsed.includes(skill)) turn.skillsUsed.push(skill)
          } else if (b.name && !turn.toolsUsed.includes(b.name)) {
            turn.toolsUsed.push(b.name)
          }
          // File-scope signal for complexity. Edit/Write/Read/MultiEdit use
          // file_path; NotebookEdit uses notebook_path.
          const path = b.input?.file_path ?? b.input?.notebook_path
          if (path && !turn.filesTouched.includes(path)) turn.filesTouched.push(path)
        }
      }
    }
  }

  return candidates.filter((c) => c.assistantCount > 0).map((c) => c.turn)
}
