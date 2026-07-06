import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

// A macOS app launched from Finder/Dock inherits launchd's minimal PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) — NOT the user's terminal PATH. Tools the user
// installed (graphify, uv → ~/.local/bin; node → nvm; brew formulae) are then
// invisible to anything Atlas spawns, and — crucially — to the agent's own Bash
// tool, which is how `query.py` reaches `graphify`. We fix this once, at the
// source: resolve the real login-shell PATH at startup and enrich every spawned
// env with it (see subscriptionEnv + knowledge/store).
//
// This module is deliberately Electron-free so the pure logic stays unit-testable
// without a mocked `app`; the packaged/dev decision is made by the caller.

const SENTINEL = '__ATLAS_PATH__:'

// Bin dirs a minimal launchd PATH omits that the user's tools commonly live in.
// Used both as the fallback when login-shell resolution fails AND as a guaranteed
// floor merged on top of the resolved PATH, so ~/.local/bin (uv tools: graphify,
// uv) is present even if the shell probe misbehaves. nvm's node bin is
// version-specific and can't be hardcoded — that's why login-shell resolution is
// the primary mechanism and this is only the safety net.
export function fallbackDirs(): string[] {
  const home = homedir()
  return [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']
}

// Pull the PATH back out of the login shell's stdout. Interactive rc files print
// banners/noise, so we tag the value with a sentinel and scan for it rather than
// trusting the whole stream.
export function parseShellPath(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf(SENTINEL)
    if (idx === -1) continue
    const value = line.slice(idx + SENTINEL.length).trim()
    return value || null
  }
  return null
}

// Real login-shell PATH first (highest priority), then the guaranteed fallback
// dirs, then whatever the current process already had (the minimal launchd PATH
// in a packaged app). Dedupe, preserving first occurrence.
export function mergePath(realPath: string | null, currentPath: string | undefined): string {
  const parts: string[] = []
  const seen = new Set<string>()
  const add = (raw: string): void => {
    const p = raw.trim()
    if (p && !seen.has(p)) {
      seen.add(p)
      parts.push(p)
    }
  }
  if (realPath) for (const p of realPath.split(':')) add(p)
  for (const p of fallbackDirs()) add(p)
  if (currentPath) for (const p of currentPath.split(':')) add(p)
  return parts.join(':')
}

// Populated once by initShellPath() at startup; read synchronously by
// enrichedPath() thereafter.
let cachedRealPath: string | null = null

// Spawn the user's login+interactive shell and echo its PATH behind the sentinel.
// -l loads the profile, -i loads the rc (where PATH mutations usually live).
// stdin is ignored so an interactive shell can't hang waiting for input, and
// stderr is ignored to swallow job-control warnings ("can't set terminal process
// group"). Resolves null on any failure — the caller merges fallback dirs anyway.
function resolveLoginShellPath(): Promise<string | null> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || '/bin/zsh'
    let out = ''
    let settled = false
    const done = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    try {
      const child = spawn(shell, ['-ilc', `command echo "${SENTINEL}$PATH"`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
      })
      child.stdout.on('data', (chunk) => {
        out += chunk.toString()
      })
      child.on('error', () => done(null))
      child.on('close', () => done(parseShellPath(out)))
    } catch {
      done(null)
    }
  })
}

// Resolve and cache the real login-shell PATH. Call once, early in app startup,
// before anything spawns a child. No-op in dev, where the process already
// inherited the developer's full terminal PATH.
export async function initShellPath(opts: { isPackaged: boolean }): Promise<void> {
  if (!opts.isPackaged) return
  cachedRealPath = await resolveLoginShellPath()
}

// The PATH to hand to spawned children (agent SDK runs, `uv`, etc). Merges the
// cached real PATH over the current process PATH + fallback dirs. Safe to call
// before initShellPath resolves — it just merges without the login-shell layer.
export function enrichedPath(): string {
  return mergePath(cachedRealPath, process.env.PATH)
}
