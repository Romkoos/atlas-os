export type Lang = 'js' | 'py'

const JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

export function langForExt(relPath: string): Lang | null {
  const dot = relPath.lastIndexOf('.')
  if (dot < 0) return null
  const ext = relPath.slice(dot)
  if (JS_EXTS.has(ext)) return 'js'
  if (ext === '.py') return 'py'
  return null
}

const JS_PATTERNS: RegExp[] = [
  // import ... from '...'  /  export ... from '...'  /  import '...'
  /(?:import|export)[^'"()]*?from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  // require('...') and dynamic import('...')
  /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

const PY_PATTERNS: RegExp[] = [/^\s*from\s+([.\w]+)\s+import\s+/gm, /^\s*import\s+([.\w]+)/gm]

// Raw specifiers only — resolution happens in resolveImport. Order-preserving,
// deduped so a file that imports the same module twice yields one edge.
export function parseImports(content: string, lang: Lang): string[] {
  const patterns = lang === 'js' ? JS_PATTERNS : PY_PATTERNS
  const seen = new Set<string>()
  const out: string[] = []
  for (const re of patterns) {
    for (const m of content.matchAll(re)) {
      const spec = m[1]
      if (spec && !seen.has(spec)) {
        seen.add(spec)
        out.push(spec)
      }
    }
  }
  return out
}
