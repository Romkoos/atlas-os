import { parseTranscriptTurns } from '@main/services/productivity/transcript'
import { describe, expect, it } from 'vitest'

// Minimal realistic Claude Code transcript lines. Real prompts carry a string
// (or text-block) content; tool results come back as `user` lines with
// tool_result content and must NOT start a new turn.
function userPrompt(text: string, ts: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'user',
    sessionId: 's1',
    cwd: '/proj',
    timestamp: ts,
    isSidechain: false,
    message: { role: 'user', content: text },
    ...extra,
  }
}

function assistant(
  usage: Record<string, number>,
  content: unknown[],
  ts: string,
  extra: Record<string, unknown> = {},
) {
  return {
    type: 'assistant',
    sessionId: 's1',
    cwd: '/proj',
    timestamp: ts,
    isSidechain: false,
    message: { role: 'assistant', usage, content },
    ...extra,
  }
}

describe('parseTranscriptTurns', () => {
  it('extracts one turn from a prompt followed by an assistant reply', () => {
    const lines = [
      userPrompt('hello', '2026-05-23T10:00:00Z'),
      assistant(
        {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
        [{ type: 'text', text: 'hi' }],
        '2026-05-23T10:00:05Z',
      ),
    ]

    const turns = parseTranscriptTurns(lines)

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      sessionId: 's1',
      projectPath: '/proj',
      turnIndex: 0,
      tokensIn: 100,
      tokensOut: 20,
      toolsUsed: [],
      skillsUsed: [],
    })
    expect(turns[0].ts).toEqual(new Date('2026-05-23T10:00:00Z'))
  })

  it('counts cache_creation in tokensIn but excludes cache_read re-reads', () => {
    const lines = [
      userPrompt('p', '2026-05-23T10:00:00Z'),
      assistant(
        {
          input_tokens: 100,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 9999, // cheap re-read of cached context — must NOT inflate
          output_tokens: 10,
        },
        [],
        '2026-05-23T10:00:05Z',
      ),
    ]

    const turns = parseTranscriptTurns(lines)

    expect(turns[0].tokensIn).toBe(150)
    expect(turns[0].tokensOut).toBe(10)
  })

  it('extracts distinct tool names from tool_use blocks, excluding Skill', () => {
    const lines = [
      userPrompt('do work', '2026-05-23T10:00:00Z'),
      assistant(
        { output_tokens: 5 },
        [
          { type: 'tool_use', name: 'Bash' },
          { type: 'tool_use', name: 'Read' },
          { type: 'tool_use', name: 'Read' },
          { type: 'tool_use', name: 'Skill', input: { skill: 'graphify' } },
        ],
        '2026-05-23T10:00:05Z',
      ),
    ]

    const turns = parseTranscriptTurns(lines)

    expect(turns[0].toolsUsed).toEqual(['Bash', 'Read'])
  })

  it('extracts skills from Skill tool_use input.skill', () => {
    const lines = [
      userPrompt('do work', '2026-05-23T10:00:00Z'),
      assistant(
        { output_tokens: 5 },
        [
          { type: 'tool_use', name: 'Skill', input: { skill: 'graphify' } },
          { type: 'tool_use', name: 'Bash' },
        ],
        '2026-05-23T10:00:05Z',
      ),
    ]

    const turns = parseTranscriptTurns(lines)

    expect(turns[0].skillsUsed).toEqual(['graphify'])
  })

  it('skips subagent (isSidechain) lines entirely', () => {
    const lines = [
      userPrompt('sub task', '2026-05-23T10:00:00Z', { isSidechain: true }),
      assistant({ input_tokens: 999, output_tokens: 99 }, [], '2026-05-23T10:00:01Z', {
        isSidechain: true,
      }),
      userPrompt('main task', '2026-05-23T10:01:00Z'),
      assistant({ input_tokens: 50, output_tokens: 10 }, [], '2026-05-23T10:01:05Z'),
    ]

    const turns = parseTranscriptTurns(lines)

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ turnIndex: 0, tokensIn: 50, tokensOut: 10 })
  })

  it('sums usage across the agentic loop; tool_result continues the turn', () => {
    const toolResult = {
      type: 'user',
      sessionId: 's1',
      cwd: '/proj',
      timestamp: '2026-05-23T10:00:06Z',
      isSidechain: false,
      message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
    }
    const lines = [
      userPrompt('p1', '2026-05-23T10:00:00Z'),
      assistant(
        { input_tokens: 100, output_tokens: 10 },
        [{ type: 'tool_use', name: 'Bash' }],
        '2026-05-23T10:00:05Z',
      ),
      toolResult,
      assistant(
        { input_tokens: 120, output_tokens: 15 },
        [{ type: 'text', text: 'done' }],
        '2026-05-23T10:00:08Z',
      ),
    ]

    const turns = parseTranscriptTurns(lines)

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ tokensIn: 220, tokensOut: 25, toolsUsed: ['Bash'] })
  })

  it('drops a trailing prompt with no assistant reply', () => {
    const lines = [
      userPrompt('p1', '2026-05-23T10:00:00Z'),
      assistant({ input_tokens: 50, output_tokens: 10 }, [], '2026-05-23T10:00:05Z'),
      userPrompt('p2 still running', '2026-05-23T10:01:00Z'),
    ]

    const turns = parseTranscriptTurns(lines)

    expect(turns).toHaveLength(1)
    expect(turns[0].turnIndex).toBe(0)
  })
})

describe('parseTranscriptTurns — filesTouched', () => {
  const userLine = {
    type: 'user',
    sessionId: 's1',
    cwd: '/proj',
    timestamp: '2026-05-23T10:00:00Z',
    message: { content: [{ type: 'text', text: 'do it' }] },
  }
  const assistantWith = (content: unknown[]) => ({
    type: 'assistant',
    message: { usage: { input_tokens: 1, output_tokens: 1 }, content },
  })

  it('collects unique file paths from Read/Edit/Write/MultiEdit/NotebookEdit', () => {
    const turns = parseTranscriptTurns([
      userLine,
      assistantWith([
        { type: 'tool_use', name: 'Read', input: { file_path: '/proj/a.ts' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/proj/a.ts' } }, // dup
        { type: 'tool_use', name: 'Write', input: { file_path: '/proj/b.ts' } },
        { type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: '/proj/n.ipynb' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }, // no path
      ]),
    ])
    expect(turns[0].filesTouched).toEqual(['/proj/a.ts', '/proj/b.ts', '/proj/n.ipynb'])
  })

  it('defaults filesTouched to [] when no file tools are used', () => {
    const turns = parseTranscriptTurns([
      userLine,
      assistantWith([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]),
    ])
    expect(turns[0].filesTouched).toEqual([])
  })
})
