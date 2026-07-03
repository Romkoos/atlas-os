import type { CodeNodeKind } from '@shared/graph'

// Categorical palette for graph node coloring (community or project). Chosen to
// read on the dark terminal background.
export const PALETTE: readonly string[] = [
  '#e6b450', // amber
  '#59c2ff', // blue
  '#7fd962', // green
  '#d2a6ff', // violet
  '#ff8f40', // orange
  '#f07178', // red
  '#5ccfe6', // cyan
  '#ffd173', // gold
  '#bae67e', // lime
  '#cfbafa', // lavender
]

export function colorForCommunity(community: number): string {
  const i = ((community % PALETTE.length) + PALETTE.length) % PALETTE.length
  return PALETTE[i]
}

export function colorForProject(project: string, projects: string[]): string {
  const i = Math.max(0, projects.indexOf(project))
  return PALETTE[i % PALETTE.length]
}

const KIND_COLORS: Record<CodeNodeKind, string> = {
  code: '#59c2ff', // blue
  doc: '#7fd962', // green
  skill: '#d2a6ff', // violet
  knowledge: '#e6b450', // amber
  session: '#ff8f40', // orange
}

export function colorForKind(kind: CodeNodeKind): string {
  return KIND_COLORS[kind] ?? '#888'
}

// graphify-origin nodes get one distinct color so the semantic layer is legible
// against the kind-colored structural layer. Magenta-purple — deliberately not
// any KIND_COLORS value (skill's violet #d2a6ff is the closest, kept separate).
export const GRAPHIFY_COLOR = '#e06fd6'

// defined_in bridge edges (graphify symbol → structural file) render muted so
// they don't compete with structural and semantic edges.
export const DEFINED_IN_EDGE_COLOR = 'rgba(210,166,255,0.25)'

export function colorForNode(node: { origin: string; kind: CodeNodeKind }): string {
  return node.origin === 'graphify' ? GRAPHIFY_COLOR : colorForKind(node.kind)
}
