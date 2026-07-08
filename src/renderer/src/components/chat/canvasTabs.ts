import type { ChatSessionType } from '@renderer/store/chats'
import type { ComponentType } from 'react'
import { IdeasCanvas } from './canvas/IdeasCanvas'
import { ReportCanvas } from './canvas/ReportCanvas'

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
    case 'skillImprover':
      return [{ key: 'report', label: 'Report', View: ReportCanvas }]
    default:
      return []
  }
}
