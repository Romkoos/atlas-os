import type { CodeGraphNode } from '@shared/graph'

type LabelNode = Pick<CodeGraphNode, 'label' | 'relPath' | 'kind'>

// Labels used by 2+ nodes in a set — the ones worth disambiguating (index.ts,
// types.ts, README.md, …). Cheap to recompute whenever the visible set changes.
export function ambiguousLabels(nodes: ReadonlyArray<{ label: string }>): Set<string> {
  const counts = new Map<string, number>()
  for (const n of nodes) counts.set(n.label, (counts.get(n.label) ?? 0) + 1)
  const dup = new Set<string>()
  for (const [label, c] of counts) if (c > 1) dup.add(label)
  return dup
}

// A disambiguating label for a file node: when its bare filename collides with
// another node's, prefix the parent folder (`auth/index.ts`). Only code/doc file
// nodes get this — skills, knowledge, and sessions carry meaningful labels
// already (folder name / article title / session label), so they're left alone.
export function displayLabel(node: LabelNode, ambiguous: Set<string>): string {
  if ((node.kind !== 'code' && node.kind !== 'doc') || !node.relPath) return node.label
  if (!ambiguous.has(node.label)) return node.label
  const parts = node.relPath.split('/')
  if (parts.length < 2) return node.label
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}
