import { z } from 'zod'
import { CLAUDE_MODEL_IDS, DEFAULT_MODEL_ID } from './models'

export const THEMES = ['system', 'light', 'dark'] as const
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export type Theme = (typeof THEMES)[number]
export type LogLevel = (typeof LOG_LEVELS)[number]

// Single source of truth for the settings shape (main store + renderer form).
// Auth is the user's Claude subscription (via Claude Code OAuth) — no API key here.
export const settingsSchema = z.object({
  model: z.enum(CLAUDE_MODEL_IDS),
  outputDir: z.string().min(1, 'Choose an output folder'),
  theme: z.enum(THEMES),
  logLevel: z.enum(LOG_LEVELS),
  // Productivity tracker: project paths to track. Empty = track all.
  // Required in the shape (default supplied by the store / DEFAULT_SETTINGS) so
  // the input and output types match for the renderer's react-hook-form.
  trackedProjects: z.array(z.string()),
  // LLM-estimate task difficulty at ingest; off by default.
  estimateDifficulty: z.boolean(),
})

export type AppSettings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Omit<AppSettings, 'outputDir'> = {
  model: DEFAULT_MODEL_ID,
  theme: 'system',
  logLevel: 'info',
  trackedProjects: [],
  estimateDifficulty: false,
}
