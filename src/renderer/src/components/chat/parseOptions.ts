// Turn-boundary option chips: the model ends a turn that offers choices with a
// fenced ```options block. We strip that block from the shown text and render
// each remaining line as a clickable chip whose text becomes the next reply.
const OPTIONS_BLOCK = /```options\s*\n([\s\S]*?)```/i

export function parseOptions(text: string): { display: string; options: string[] } {
  const match = text.match(OPTIONS_BLOCK)
  if (!match) return { display: text, options: [] }
  const options = match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const display = text.replace(OPTIONS_BLOCK, '').trim()
  return { display, options }
}
