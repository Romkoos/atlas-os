import type { ChatSessionType } from '@renderer/store/chats'
import type { ComponentType } from 'react'
import { BrainstormCanvas } from './canvas/BrainstormCanvas'
import { IdeasCanvas } from './canvas/IdeasCanvas'
import { ReportCanvas } from './canvas/ReportCanvas'

export interface CanvasTab {
  key: string
  label: string
  // Views receive the active chat type so type-aware views (e.g. the Artifact
  // view) can read the right run store. Type-agnostic views simply ignore it.
  View: ComponentType<{ type: ChatSessionType }>
}

// The interactive brainstorm artifact — the model's current pending options as
// clickable cards. Registered for every chat type (appended, so the two types
// with a purpose-built view keep it as their default first tab).
const ARTIFACT_TAB: CanvasTab = { key: 'artifact', label: 'Artifact', View: BrainstormCanvas }

// The Canvas tab set for a chat type. roadmap/skillImprover keep their
// purpose-built view first; every type gets the Artifact view appended.
export function tabsForType(type: ChatSessionType): CanvasTab[] {
  switch (type) {
    case 'roadmap':
      return [{ key: 'ideas', label: 'Ideas', View: IdeasCanvas }, ARTIFACT_TAB]
    case 'skillImprover':
      return [{ key: 'report', label: 'Report', View: ReportCanvas }, ARTIFACT_TAB]
    default:
      return [ARTIFACT_TAB]
  }
}
