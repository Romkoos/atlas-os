import { createChatRunStore } from '@renderer/store/createChatRunStore'
import { type ImproverReport, REPORT_SENTINEL } from '@shared/skillImprover'
import { create } from 'zustand'

// Skill-improver run. Persisted + resumable-on-refresh via the generic factory;
// the subscription is hosted at App level (ChatHost). App-restart resume is
// disabled backend-side (the improver owns a transactional workspace). The
// report sentinel is stripped from committed assistant text so the raw token
// never shows in the transcript — the rendered report replaces it.
export const useSkillImproverRun = createChatRunStore('atlas-chat-run-improver', {
  sanitizeStreaming: (text) => text.split(REPORT_SENTINEL).join(''),
})

// Domain extras: the target skillId (kickoff) and the A/B report. Not persisted
// — a torn-down improver session cannot be resumed after restart, so these
// reset on reload.
interface ImproverExtraState {
  skillId: string | null
  report: ImproverReport | null
  setSkill: (id: string) => void
  setReport: (r: ImproverReport) => void
  clear: () => void
}
export const useSkillImproverExtra = create<ImproverExtraState>((set) => ({
  skillId: null,
  report: null,
  setSkill: (skillId) => set({ skillId }),
  setReport: (report) => set({ report }),
  clear: () => set({ skillId: null, report: null }),
}))
