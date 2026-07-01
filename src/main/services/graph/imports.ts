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
  /\b(?:import|export)\b[^'"()]*?from\s*['"]([^'"]+)['"]/g,
  /\bimport\b\s*['"]([^'"]+)['"]/g,
  // require('...') and dynamic import('...')
  /\b(?:require|import)\b\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
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

const JS_CANDIDATE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const JS_INDEX = JS_CANDIDATE_EXTS.map((e) => `/index${e}`)

// Join a from-file's directory with a relative spec and normalise `.`/`..`,
// producing a repo-relative POSIX path (no leading `./`).
function joinRel(fromRelPath: string, rel: string): string {
  const dir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : ''
  const parts = dir ? dir.split('/') : []
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

export function resolveImport(
  fromRelPath: string,
  spec: string,
  fileSet: ReadonlySet<string>,
  lang: Lang,
): string | null {
  if (lang === 'js') {
    if (!spec.startsWith('.')) return null // bare / external
    const base = joinRel(fromRelPath, spec)
    if (fileSet.has(base)) return base
    for (const ext of JS_CANDIDATE_EXTS) if (fileSet.has(base + ext)) return base + ext
    for (const idx of JS_INDEX) if (fileSet.has(base + idx)) return base + idx
    return null
  }
  // python: only relative imports (leading dots) are resolvable to repo files.
  if (!spec.startsWith('.')) return null
  let up = 0
  while (up < spec.length && spec[up] === '.') up++
  const tail = spec.slice(up).replace(/\./g, '/')
  const dir = fromRelPath.includes('/') ? fromRelPath.slice(0, fromRelPath.lastIndexOf('/')) : ''
  const parts = dir ? dir.split('/') : []
  for (let i = 1; i < up; i++) parts.pop() // one dot = current pkg dir; extra dots go up
  const base = [...parts, ...(tail ? tail.split('/') : [])].join('/')
  if (fileSet.has(`${base}.py`)) return `${base}.py`
  if (fileSet.has(`${base}/__init__.py`)) return `${base}/__init__.py`
  return null
}
