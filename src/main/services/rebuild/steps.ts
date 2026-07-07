import { basename, dirname, join } from 'node:path'

// Pure, Electron-free helpers for the rebuild pipeline, so the fiddly bits
// (dirty-tree detection, bundle resolution, swap-script generation) stay
// unit-testable without mocking `app` or spawning anything. The packaged/dev
// decision and all IO live in registry.ts.

export const PRODUCT_NAME = 'Atlas OS'

// `git status --porcelain` prints one line per changed/untracked path and
// nothing at all for a clean tree. Anything non-blank means dirty.
export function isWorkingTreeDirty(porcelainStdout: string): boolean {
  return porcelainStdout.trim().length > 0
}

// Walk up from the running executable to the enclosing `.app` bundle.
// e.g. "/Applications/Atlas OS.app/Contents/MacOS/Atlas OS" → "/Applications/Atlas OS.app".
// Returns null when not inside a bundle (e.g. `pnpm dev`, where execPath is the
// Electron binary in node_modules).
export function resolveRunningBundle(execPath: string): string | null {
  let cur = execPath
  // Stop at the filesystem root (dirname of "/" is "/").
  while (cur && cur !== dirname(cur)) {
    if (cur.endsWith('.app')) return cur
    cur = dirname(cur)
  }
  return null
}

// The install location to replace. Packaged: the currently-running bundle. Dev:
// there is no bundle, so fall back to the conventional install path from the
// deploy protocol.
export function resolveTargetBundle(execPath: string): string {
  return resolveRunningBundle(execPath) ?? `/Applications/${PRODUCT_NAME}.app`
}

// electron-builder stages the unpacked `.app` under release/mac<arch>/ before
// packaging the dmg. Given the directory entries of the release dir, pick the
// first `mac`-prefixed one and point at the bundle inside it.
export function pickStagedBundle(releaseDir: string, releaseEntries: string[]): string | null {
  const macDir = releaseEntries.find((name) => name === 'mac' || name.startsWith('mac-'))
  if (!macDir) return null
  return join(releaseDir, macDir, `${PRODUCT_NAME}.app`)
}

// Single-quote a string for POSIX sh: wrap in '…' and escape embedded quotes as
// '\''. Safe for paths with spaces (every bundle path has one).
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

// The detached relaunch script. It must outlive the app: it waits for the old
// PID to exit, replaces the installed bundle with the freshly-staged one, and
// reopens it. `ditto` faithfully copies bundle metadata/permissions.
export function swapScript(opts: { oldPid: number; staged: string; target: string }): string {
  const staged = shellQuote(opts.staged)
  const target = shellQuote(opts.target)
  return [
    '#!/bin/sh',
    'set -e',
    `# Wait for Atlas OS (pid ${opts.oldPid}) to fully quit before touching its bundle.`,
    `while kill -0 ${opts.oldPid} 2>/dev/null; do sleep 0.3; done`,
    `rm -rf ${target}`,
    `ditto ${staged} ${target}`,
    `open ${target}`,
    '',
  ].join('\n')
}

// Name of the swap script written under userData.
export const SWAP_SCRIPT_NAME = 'rebuild-swap-and-relaunch.sh'

export function swapScriptPath(userDataDir: string): string {
  return join(userDataDir, SWAP_SCRIPT_NAME)
}

// Split a raw chunk of child stdout/stderr into whole lines, carrying the
// trailing partial line back to the caller. Keeps streamed log lines intact.
export function splitLines(buffered: string, chunk: string): { lines: string[]; rest: string } {
  const combined = buffered + chunk
  const parts = combined.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}

// Guard against a runaway log buffer (a chatty install can print thousands of
// lines). Keep the newest N.
export function capLog(log: string[], max: number): string[] {
  return log.length > max ? log.slice(log.length - max) : log
}

// Re-export for callers that build the display label.
export function bundleName(path: string): string {
  return basename(path)
}
