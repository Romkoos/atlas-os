import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { db } from '@main/db/client'
import { logger } from '@main/logger'
import { subscriptionEnv } from '@main/services/llm/subscriptionEnv'
import {
  type CodeGraph,
  type CodeGraphEdge,
  type CodeGraphNode,
  type CodeNodeKind,
  codeEdgeId,
  codeNodeId,
} from '@shared/graph'
import type { GraphDeepMapEvent } from '@shared/ipc-events'

import { loadGraph, saveGraphifyGraph } from './store'

export interface GraphifyNode {
  id: string
  label?: string
  source_file?: string
  file_type?: string
  community?: number
}
export interface GraphifyLink {
  source?: string
  target?: string
  _src?: string
  _tgt?: string
  relation?: string
  confidence?: string
}
export interface GraphifyJson {
  nodes: GraphifyNode[]
  links: GraphifyLink[]
}

// Defensive parse of graphify's networkx node-link graph.json. Never throws.
export function parseGraphifyJson(raw: string): GraphifyJson {
  try {
    const d = JSON.parse(raw) as Record<string, unknown>
    const nodes = Array.isArray(d.nodes) ? (d.nodes as GraphifyNode[]) : []
    const links = Array.isArray(d.links)
      ? (d.links as GraphifyLink[])
      : Array.isArray(d.edges)
        ? (d.edges as GraphifyLink[])
        : []
    return { nodes, links }
  } catch {
    return { nodes: [], links: [] }
  }
}

function kindForFileType(fileType: string | undefined): CodeNodeKind {
  if (fileType === 'markdown' || fileType === 'doc') return 'doc'
  return 'code'
}

// Merge graphify's LLM graph onto the structural graph. Returns ONLY the
// graphify-origin additions (new nodes + semantic edges) — the caller persists
// these as the 'graphify' layer, leaving the 'indexer' layer untouched.
export function mergeGraphifyGraph(
  projectPath: string,
  structural: CodeGraph,
  gy: GraphifyJson,
): CodeGraph {
  const relToExistingId = new Map<string, string>()
  for (const n of structural.nodes) if (n.relPath) relToExistingId.set(n.relPath, n.id)

  const gidToRel = new Map<string, string>()
  for (const gn of gy.nodes) if (gn.id && gn.source_file) gidToRel.set(gn.id, gn.source_file)

  const newNodes = new Map<string, CodeGraphNode>()

  const resolveNodeId = (gid: string | undefined): string | null => {
    if (!gid) return null
    const rel = gidToRel.get(gid)
    if (rel && relToExistingId.has(rel)) return relToExistingId.get(rel) as string
    // graphify knows a file the structural pass didn't index → create it.
    const gn = gy.nodes.find((n) => n.id === gid)
    if (!gn) return null // dangling reference: id not present in gy.nodes → skip, don't fabricate
    const kind = kindForFileType(gn.file_type)
    const key = rel ?? gid
    const id = codeNodeId(projectPath, kind, key)
    if (!newNodes.has(id)) {
      newNodes.set(id, {
        id,
        projectPath,
        kind,
        label: gn?.label ?? (rel ? basename(rel) : gid),
        relPath: rel ?? null,
        meta: { origin: 'graphify' },
        community: typeof gn?.community === 'number' ? gn.community : null,
        origin: 'graphify',
      })
    }
    return id
  }

  const edges: CodeGraphEdge[] = []
  const seen = new Set<string>()
  for (const l of gy.links) {
    const s = resolveNodeId(l.source ?? l._src)
    const t = resolveNodeId(l.target ?? l._tgt)
    if (!s || !t || s === t) continue
    const id = codeEdgeId(s, t, 'semantic')
    if (seen.has(id)) continue
    seen.add(id)
    const audit = l.confidence ?? 'INFERRED'
    edges.push({
      id,
      projectPath,
      source: s,
      target: t,
      kind: 'semantic',
      inferred: audit !== 'EXTRACTED',
      origin: 'graphify',
      meta: { audit, relation: l.relation ?? null },
    })
  }

  return { nodes: [...newNodes.values()], edges }
}

export interface GraphifyDeepMapRun {
  cancel: () => void
  done: Promise<void>
}
export interface RunGraphifyOptions {
  projectPath: string
  model: string
  emit: (event: GraphDeepMapEvent) => void
}

// Read-only-ish deep map: run the /graphify skill in a headless Claude session,
// then merge its semantic edges. The skill needs to run its own tooling, so we
// allow the standard tool set and bypass permissions (like roadmapChat).
export function runGraphifyDeepMap(opts: RunGraphifyOptions): GraphifyDeepMapRun {
  const controller = new AbortController()
  let stopped = false
  let failed = false

  const done = (async (): Promise<void> => {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const prompt = `/graphify ${opts.projectPath} --no-viz`
    const q = query({
      prompt,
      options: {
        model: opts.model,
        permissionMode: 'bypassPermissions',
        settingSources: ['user', 'project'],
        cwd: opts.projectPath,
        env: subscriptionEnv(),
        abortController: controller,
      },
    })

    for await (const message of q as AsyncIterable<SDKMessage>) {
      if (stopped) continue
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            opts.emit({ type: 'tool', name: block.name, summary: block.name })
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          opts.emit({ type: 'progress', message: 'graphify run finished; merging…' })
        } else {
          failed = true
          const reason = message.errors?.join('; ') || message.subtype
          opts.emit({ type: 'error', message: `Graphify run failed: ${reason}` })
        }
      }
    }
    if (stopped || failed) return

    // Read + merge graph.json produced in projectPath/graphify-out/.
    let raw: string
    try {
      raw = readFileSync(join(opts.projectPath, 'graphify-out', 'graph.json'), 'utf8')
    } catch {
      opts.emit({ type: 'error', message: 'graphify produced no graph.json' })
      return
    }
    const structural = loadGraph(db(), opts.projectPath)
    const additions = mergeGraphifyGraph(opts.projectPath, structural, parseGraphifyJson(raw))
    saveGraphifyGraph(db(), opts.projectPath, additions)
    opts.emit({
      type: 'done',
      nodesAdded: additions.nodes.length,
      edgesAdded: additions.edges.length,
    })
  })().catch((error) => {
    if (stopped) return
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Graphify deep-map failed', message)
    opts.emit({ type: 'error', message })
  })

  return {
    cancel: () => {
      if (stopped) return
      stopped = true
      controller.abort()
      void done.then(() => opts.emit({ type: 'aborted' }))
    },
    done,
  }
}
