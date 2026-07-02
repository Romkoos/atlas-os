import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import {
  assertInside,
  projectNameForPath,
  readArticle,
  storeRoot,
} from '@main/services/knowledge/store'
import type { CodeGraphNode, NodePreview } from '@shared/graph'

const MAX_LINES = 200
const MAX_BYTES = 256 * 1024

// Coarse language hints for the code-block label / syntax intent. `.md` is
// deliberately absent: markdown-backed nodes render through react-markdown, not
// a code block, so the UI keys off language === 'markdown' set explicitly.
const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.json': 'json',
  '.css': 'css',
  '.scss': 'scss',
  '.html': 'html',
  '.sh': 'bash',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.sql': 'sql',
}

function cap(content: string): Pick<NodePreview, 'content' | 'totalLines' | 'truncated'> {
  const lines = content.split('\n')
  if (lines.length <= MAX_LINES) return { content, totalLines: lines.length, truncated: false }
  return {
    content: lines.slice(0, MAX_LINES).join('\n'),
    totalLines: lines.length,
    truncated: true,
  }
}

// A bounded, traversal-guarded source preview for a node's backing file. All
// path inputs come from the stored (trusted) node record, and every path is
// still re-checked with assertInside as defense in depth. Sessions (no file),
// missing files, and read errors return null.
export function readNodePreview(node: CodeGraphNode): NodePreview | null {
  if (node.kind === 'session' || !node.relPath) return null

  // Markdown-backed knowledge articles live under the knowledge store, keyed by
  // the store's own project name — not the code project's on-disk path.
  if (node.kind === 'knowledge') {
    const project = projectNameForPath(storeRoot(), node.projectPath)
    if (!project) return null
    try {
      const { body } = readArticle(storeRoot(), project, node.relPath)
      if (!body) return null
      return { language: 'markdown', ...cap(body) }
    } catch {
      return null
    }
  }

  // code / doc / skill: a file under the project root.
  let abs: string
  try {
    abs = assertInside(node.projectPath, node.relPath)
  } catch {
    return null
  }
  if (!existsSync(abs)) return null
  try {
    const ext = extname(abs)
    const markdown = ext === '.md' || ext === '.mdx'
    const size = statSync(abs).size
    const raw =
      size > MAX_BYTES
        ? readFileSync(abs).subarray(0, MAX_BYTES).toString('utf8')
        : readFileSync(abs, 'utf8')
    const capped = cap(raw)
    return {
      language: markdown ? 'markdown' : (LANG_BY_EXT[ext] ?? null),
      content: capped.content,
      totalLines: capped.totalLines,
      truncated: capped.truncated || size > MAX_BYTES,
    }
  } catch {
    return null
  }
}
