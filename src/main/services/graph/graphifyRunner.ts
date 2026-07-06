import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { db } from '@main/db/client'
import { logger } from '@main/logger'
import { claudeSdkExecutableOption } from '@main/paths'
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

import { indexProject } from './indexer'
import { exportMap } from './mapExport'
import { loadGraph, saveGraphifyGraph, saveStructuralGraph } from './store'

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

// Merge graphify's LLM graph onto the structural graph as the 'graphify' layer.
// Unlike a collapse, this keeps graphify's full node set (symbols + concepts) as
// distinct graphify-origin nodes, connects them with their semantic edges, and
// bridges each to the structural file node that defines it (defined_in). The
// caller persists these as the 'graphify' layer; the 'indexer' layer is untouched.
export function mergeGraphifyGraph(
  projectPath: string,
  structural: CodeGraph,
  gy: GraphifyJson,
): CodeGraph {
  const relToStructId = new Map<string, string>()
  for (const n of structural.nodes) if (n.relPath) relToStructId.set(n.relPath, n.id)

  const newNodes = new Map<string, CodeGraphNode>()
  const gidToNodeId = new Map<string, string>()
  for (const gn of gy.nodes) {
    if (!gn.id) continue
    const kind = kindForFileType(gn.file_type)
    const id = codeNodeId(projectPath, kind, gn.id)
    gidToNodeId.set(gn.id, id)
    if (!newNodes.has(id)) {
      newNodes.set(id, {
        id,
        projectPath,
        kind,
        label: gn.label ?? (gn.source_file ? basename(gn.source_file) : gn.id),
        relPath: gn.source_file ?? null,
        meta: { origin: 'graphify', graphifyId: gn.id },
        community: typeof gn.community === 'number' ? gn.community : null,
        origin: 'graphify',
      })
    }
  }

  const edges: CodeGraphEdge[] = []
  const seen = new Set<string>()

  // Semantic edges among graphify nodes (skip endpoints not in the node set).
  for (const l of gy.links) {
    const s = gidToNodeId.get(l.source ?? l._src ?? '')
    const t = gidToNodeId.get(l.target ?? l._tgt ?? '')
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

  // defined_in bridges: graphify node → the structural file node it belongs to.
  for (const gn of gy.nodes) {
    if (!gn.id || !gn.source_file) continue
    const structId = relToStructId.get(gn.source_file)
    const gNodeId = gidToNodeId.get(gn.id)
    if (!structId || !gNodeId || structId === gNodeId) continue
    const id = codeEdgeId(gNodeId, structId, 'defined_in')
    if (seen.has(id)) continue
    seen.add(id)
    edges.push({
      id,
      projectPath,
      source: gNodeId,
      target: structId,
      kind: 'defined_in',
      inferred: false,
      origin: 'graphify',
      meta: { relation: 'defined_in' },
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
    opts.emit({ type: 'progress', message: '1/4 indexing structure…' })
    const structural = indexProject(db(), opts.projectPath)
    saveStructuralGraph(db(), opts.projectPath, structural)
    if (stopped) return
    opts.emit({ type: 'progress', message: '2/4 running graphify (semantic + wiki)…' })

    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const prompt = `/graphify ${opts.projectPath} --wiki`
    const q = query({
      prompt,
      options: {
        model: opts.model,
        permissionMode: 'bypassPermissions',
        settingSources: ['user', 'project'],
        cwd: opts.projectPath,
        env: subscriptionEnv(),
        abortController: controller,
        ...claudeSdkExecutableOption(),
        // Headless run: the graphify skill asks the user "which subfolder?" on
        // repos over 200 files via AskUserQuestion — a tool with no one to answer
        // it here. Block it so the skill proceeds on the full path instead of
        // stalling or silently scoping down. graphify still gets Bash/Agent/
        // Read/Write, which its pipeline needs.
        disallowedTools: ['AskUserQuestion'],
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
    if (stopped) return

    const graphifyOutDir = join(opts.projectPath, 'graphify-out')

    // graphify failed or produced nothing → still export a structural-only map so
    // the store + SessionStart hook aren't empty, then surface the error.
    if (failed) {
      exportMap(opts.projectPath, graphifyOutDir, loadGraph(db(), opts.projectPath))
      return
    }

    let raw: string
    try {
      raw = readFileSync(join(graphifyOutDir, 'graph.json'), 'utf8')
    } catch {
      opts.emit({ type: 'error', message: 'graphify produced no graph.json' })
      exportMap(opts.projectPath, graphifyOutDir, loadGraph(db(), opts.projectPath))
      return
    }

    try {
      JSON.parse(raw)
    } catch {
      opts.emit({ type: 'error', message: 'graphify graph.json is not valid JSON' })
      exportMap(opts.projectPath, graphifyOutDir, loadGraph(db(), opts.projectPath))
      return
    }

    opts.emit({ type: 'progress', message: '3/4 merging semantic edges…' })
    const additions = mergeGraphifyGraph(
      opts.projectPath,
      loadGraph(db(), opts.projectPath),
      parseGraphifyJson(raw),
    )
    saveGraphifyGraph(db(), opts.projectPath, additions)

    opts.emit({ type: 'progress', message: '4/4 exporting map to store…' })
    exportMap(opts.projectPath, graphifyOutDir, loadGraph(db(), opts.projectPath))

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
