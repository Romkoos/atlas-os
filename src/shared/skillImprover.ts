import { z } from 'zod'

// Printed by the agent on its own line right after it writes the report JSON, so
// the main-process run service knows to read + parse it. Lives in shared so the
// renderer can strip it from the streamed transcript. Keep it unusual so it
// never collides with normal output.
export const REPORT_SENTINEL = '<<ATLAS_REPORT_READY>>'

// One eval's result within an iteration. The model fills these from its A/B runs.
const evalResultSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  notes: z.string().optional(),
})

// One benchmarked version: n=0 is the baseline (original skill), n>=1 the
// successive improved iterations. Metrics are optional — degrade in the UI.
const iterationSchema = z.object({
  n: z.number(),
  passRate: z.number().optional(),
  tokens: z.number().optional(),
  durationMs: z.number().optional(),
  perEval: z.array(evalResultSchema).optional(),
})

// The full A/B report the improver writes at the end of a session. Fields beyond
// skillName + iterations are optional because the model generates this JSON.
export const improverReportSchema = z.object({
  skillName: z.string(),
  iterations: z.array(iterationSchema),
  beforeDescription: z.string().optional(),
  afterDescription: z.string().optional(),
  diffSummary: z.string().optional(),
  analystSummary: z.string().optional(),
})

export type ImproverReport = z.infer<typeof improverReportSchema>

// Tolerant parse for report JSON read off disk: returns null on bad JSON or a
// shape mismatch so the caller can fall back to a "report unavailable" state.
export function parseImproverReport(raw: string): ImproverReport | null {
  try {
    return improverReportSchema.parse(JSON.parse(raw))
  } catch {
    return null
  }
}
