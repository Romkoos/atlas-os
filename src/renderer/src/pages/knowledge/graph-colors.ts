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
