#!/usr/bin/env node
// Enforced Version Bump on Deploy Push.
//
// A `simple-git-hooks` pre-push hook. On the first push of a branch it ensures
// package.json carries a patch bump over origin/main, commits that bump on its
// own, and aborts the current push so the follow-up push includes it. On any
// subsequent push of an already-bumped branch it skips silently, so re-running
// `pnpm dist` / re-pushing never double-bumps.
//
// Design note: a git pre-push hook runs AFTER git has resolved the ref being
// pushed, so a commit created here is NOT part of the in-flight push. We
// therefore create the bump commit and exit non-zero to cancel this push; the
// next push sees the branch is already ahead of origin/main and proceeds.
//
// Everything except a *successful bump* fails open (exit 0) — a hook must never
// wedge a push because a lookup failed.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SEMVER_RE = /^\d+\.\d+\.\d+$/
const BUMP_BASELINE_REF = 'origin/main'

// ---------------------------------------------------------------------------
// Pure logic (unit-tested)
// ---------------------------------------------------------------------------

/** Parse the `version` field out of package.json text. Returns null on any problem. */
export function parseVersion(pkgJsonText) {
  try {
    const parsed = JSON.parse(pkgJsonText)
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

/** True only for a plain `x.y.z` (no pre-release / build metadata). */
export function isValidSemver(version) {
  return typeof version === 'string' && SEMVER_RE.test(version)
}

/** Increment the patch segment of a valid `x.y.z`. Throws on invalid input. */
export function bumpPatch(version) {
  if (!isValidSemver(version)) {
    throw new Error(`Cannot bump non-semver version: ${String(version)}`)
  }
  const [major, minor, patch] = version.split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

/**
 * Decide whether this push should skip the bump based on the ref lines git
 * passes on stdin (`<local-ref> <local-sha> <remote-ref> <remote-sha>`).
 * Skip when every ref is a delete (local sha all-zeros) or a tag; act only when
 * at least one normal branch ref is being pushed.
 */
export function shouldSkipForRefs(stdinText) {
  const lines = String(stdinText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const hasActionableRef = lines.some((line) => {
    const [localRef, localSha, remoteRef] = line.split(/\s+/)
    const isDelete = /^0+$/.test(localSha || '')
    const isTag =
      (remoteRef || '').startsWith('refs/tags/') || (localRef || '').startsWith('refs/tags/')
    return !isDelete && !isTag
  })

  return !hasActionableRef
}

/**
 * Given the local version and the origin/main baseline, decide the action.
 * Returns { action: 'bump', next } or { action: 'skip', reason }.
 */
export function decideBump({ localVersion, baselineVersion }) {
  if (!isValidSemver(localVersion)) {
    return { action: 'skip', reason: 'invalid-local' }
  }
  if (baselineVersion == null) {
    return { action: 'skip', reason: 'no-baseline' }
  }
  if (localVersion !== baselineVersion) {
    return { action: 'skip', reason: 'already-bumped' }
  }
  return { action: 'bump', next: bumpPatch(localVersion) }
}

/**
 * Replace the first `"version": "..."` occurrence (the package version) with
 * `nextVersion`, preserving all surrounding formatting and trailing newline.
 */
export function setVersion(pkgJsonText, nextVersion) {
  return pkgJsonText.replace(/("version"\s*:\s*")[^"]+(")/, `$1${nextVersion}$2`)
}

// ---------------------------------------------------------------------------
// Imperative orchestration (runs only when executed directly)
// ---------------------------------------------------------------------------

function readStdinSync() {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
}

function gitBaselineVersion(repoRoot) {
  try {
    const text = execFileSync('git', ['show', `${BUMP_BASELINE_REF}:package.json`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return parseVersion(text)
  } catch {
    return null
  }
}

function main() {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const repoRoot = resolve(scriptDir, '..')
  const pkgPath = resolve(repoRoot, 'package.json')

  try {
    // 1) Push-type guard: ignore deletes and tag pushes.
    if (shouldSkipForRefs(readStdinSync())) {
      return 0
    }

    // 2) Read local + origin/main baseline versions.
    const pkgText = readFileSync(pkgPath, 'utf8')
    const localVersion = parseVersion(pkgText)
    const baselineVersion = gitBaselineVersion(repoRoot)

    // 3) Decide.
    const decision = decideBump({ localVersion, baselineVersion })
    if (decision.action === 'skip') {
      return 0
    }

    // 4) Write the bumped version, preserving formatting.
    const nextText = setVersion(pkgText, decision.next)
    if (nextText === pkgText) {
      // Defensive: nothing changed (unexpected) — never block the push.
      return 0
    }
    writeFileSync(pkgPath, nextText)

    // 5) Commit only package.json, skipping the pre-commit lint/typecheck hook.
    execFileSync(
      'git',
      [
        'commit',
        '--no-verify',
        '-m',
        `chore: bump version to ${decision.next}`,
        '--',
        'package.json',
      ],
      { cwd: repoRoot, stdio: ['ignore', 'ignore', 'inherit'] },
    )

    // 6) Abort this push so the follow-up push includes the bump commit.
    process.stderr.write(
      `\n[atlas-os] Version bumped to ${decision.next} and committed — please run your push again.\n\n`,
    )
    return 1
  } catch {
    // Fail open: never wedge a push because of an unexpected error.
    return 0
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  process.exit(main())
}
