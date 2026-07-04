import type { RoadmapItem, RoadmapPriority } from '@shared/roadmap'

// Dashboard "NEXT UP" digest of the kanban board: what's being worked on right
// now, what's queued next (planned before todo, high priority first), and what
// shipped most recently. Caps keep the panel a digest, not a second board.
const PRIORITY_ORDER: Record<RoadmapPriority, number> = { high: 0, medium: 1, low: 2 }

export interface NextUpGroups {
  inProgress: RoadmapItem[]
  nextUp: RoadmapItem[]
  done: RoadmapItem[]
}

const byRecency = (a: RoadmapItem, b: RoadmapItem): number => b.updatedAt - a.updatedAt
const byPriority = (a: RoadmapItem, b: RoadmapItem): number =>
  PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.position - b.position

export function groupNextUp(items: RoadmapItem[]): NextUpGroups {
  const inProgress = items
    .filter((i) => i.status === 'in-progress')
    .sort(byRecency)
    .slice(0, 3)
  const planned = items.filter((i) => i.status === 'planned').sort(byPriority)
  const todo = items.filter((i) => i.status === 'todo').sort(byPriority)
  const nextUp = [...planned, ...todo].slice(0, 4)
  const done = items
    .filter((i) => i.status === 'done')
    .sort(byRecency)
    .slice(0, 3)
  return { inProgress, nextUp, done }
}
