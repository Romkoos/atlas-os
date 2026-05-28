import { BlockMath, InlineMath } from 'react-katex'

// Inline:  <Formula tex="E = mc^2" />
// Block:   <Formula display tex="\\sum_{i=1}^n x_i" />
export function Formula({ tex, display = false }: { tex: string; display?: boolean }) {
  return display ? <BlockMath math={tex} /> : <InlineMath math={tex} />
}
