import type { CodeNodeKind } from '@shared/graph'

// Categorical palette for graph node coloring (community or project). Tuned to
// the cool near-black background: slots 1–2 mirror the app accents (amber,
// cyan), the rest keep matched chroma/lightness so no hue shouts.
export const PALETTE: readonly string[] = [
  '#f5b13d', // amber (≈ --amber)
  '#4fd6e8', // cyan (≈ --cyan)
  '#86e07c', // green
  '#c9a8ff', // violet
  '#ff9550', // orange
  '#ff6b74', // red
  '#6cb2ff', // blue
  '#ffd685', // gold
  '#c8e88a', // lime
  '#d6c2ff', // lavender
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
  code: '#6cb2ff', // blue
  doc: '#86e07c', // green
  skill: '#c9a8ff', // violet
  knowledge: '#f5b13d', // amber
  session: '#ff9550', // orange
}

export function colorForKind(kind: CodeNodeKind): string {
  return KIND_COLORS[kind] ?? '#888'
}

// graphify-origin nodes get one distinct color so the semantic layer is legible
// against the kind-colored structural layer. Magenta-purple — deliberately not
// any KIND_COLORS value (skill's violet #c9a8ff is the closest, kept separate).
export const GRAPHIFY_COLOR = '#e878d8'

// defined_in bridge edges (graphify symbol → structural file) render muted so
// they don't compete with structural and semantic edges.
export const DEFINED_IN_EDGE_COLOR = 'rgba(201, 168, 255, 0.25)'

export function colorForNode(node: { origin: string; kind: CodeNodeKind }): string {
  return node.origin === 'graphify' ? GRAPHIFY_COLOR : colorForKind(node.kind)
}
