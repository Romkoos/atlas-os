import {
  ROADMAP_STATUSES,
  type RoadmapCategory,
  type RoadmapItem,
  type RoadmapPriority,
  type RoadmapStatus,
} from '@shared/roadmap'

export type CategoryFilter = 'all' | RoadmapCategory

const PRIORITY_RANK: Record<RoadmapPriority, number> = { high: 0, medium: 1, low: 2 }

// Short badge labels for the card's category chip.
export const CATEGORY_SHORT: Record<RoadmapCategory, string> = {
  intelligence: 'INT',
  observability: 'OBS',
  macos: 'MAC',
  connectivity: 'CONN',
  wow: 'WOW',
}

export function hideDoneFilter(items: RoadmapItem[], hideDone: boolean): RoadmapItem[] {
  return hideDone ? items.filter((i) => i.status !== 'done') : items
}

export function filterByCategory(items: RoadmapItem[], filter: CategoryFilter): RoadmapItem[] {
  return filter === 'all' ? items : items.filter((i) => i.category === filter)
}

// Priority High→Low, then most-recently-updated first. Non-mutating.
export function sortColumnItems(items: RoadmapItem[]): RoadmapItem[] {
  return [...items].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.updatedAt - a.updatedAt,
  )
}

export function groupByStatus(items: RoadmapItem[]): Record<RoadmapStatus, RoadmapItem[]> {
  const groups = Object.fromEntries(
    ROADMAP_STATUSES.map((s) => [s, [] as RoadmapItem[]]),
  ) as unknown as Record<RoadmapStatus, RoadmapItem[]>
  for (const item of items) groups[item.status].push(item)
  return groups
}
