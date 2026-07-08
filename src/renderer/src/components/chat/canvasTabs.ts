import type { ChatSessionType } from '@renderer/store/chats'
import type { ComponentType } from 'react'
import { IdeasCanvas } from './canvas/IdeasCanvas'
import { ReportCanvas } from './canvas/ReportCanvas'
import { ResultsCanvas } from './canvas/ResultsCanvas'

export interface CanvasTab {
  key: string
  label: string
  View: ComponentType
}

// The Canvas tab set for a chat type. Phase 1: reuse-only views. worker &
// generalChat get their tabs (Changes/Docs/Artifact, Artifact/Context) in Phase 2.
export function tabsForType(type: ChatSessionType): CanvasTab[] {
  switch (type) {
    case 'roadmap':
      return [{ key: 'ideas', label: 'Ideas', View: IdeasCanvas }]
    case 'benchmark':
      return [{ key: 'results', label: 'Results', View: ResultsCanvas }]
    case 'skillImprover':
      return [{ key: 'report', label: 'Report', View: ReportCanvas }]
    default:
      return []
  }
}
