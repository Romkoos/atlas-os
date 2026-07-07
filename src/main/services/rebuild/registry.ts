import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '@main/logger'
import { repoRoot } from '@main/paths'
import { type JobHandle, jobRegistry } from '@main/services/jobs/registry'
import { enrichedPath } from '@main/services/llm/shellPath'
import type { RebuildEvent, RebuildSnapshot, RebuildState } from '@shared/rebuild'
import { app } from 'electron'
import {
  capLog,
  isWorkingTreeDirty,
  pickStagedBundle,
  resolveTargetBundle,
  splitLines,
  swapScript,
  swapScriptPath,
} from './steps'

const MAX_LOG = 2000

// Singleton owner of the "Rebuild & Update" run. Decoupled from any subscription
// (unlike news.run, whose teardown cancels): the child processes and log buffer
// live here, so leaving the Settings modal never kills the build — the router's
// subscription only replays the buffer and forwards live events. One run at a
// time; state drives the renderer modal.
class RebuildRun extends EventEmitter {
  private state: RebuildState = 'idle'
  private log: string[] = []
  private child: ChildProcess | null = null
  private bundlePath: string | null = null
  private job: JobHandle | null = null
  private cancelled = false

  constructor() {
    super()
    // The subscription may re-attach (dev double-mount, reattach on modal open).
    this.setMaxListeners(20)
  }

  snapshot(): RebuildSnapshot {
    return { state: this.state, log: [...this.log], bundlePath: this.bundlePath }
  }

  private setState(next: RebuildState): void {
    this.state = next
    this.emit('event', { state: next } satisfies RebuildEvent)
  }

  private append(line: string): void {
    this.log.push(line)
    this.log = capLog(this.log, MAX_LOG)
    this.emit('event', { state: this.state, line } satisfies RebuildEvent)
  }

  // Kick off build-from-prod. Rejects if a run is already active.
  async start(): Promise<void> {
    if (
      this.state === 'running' ||
      this.state === 'awaiting-confirm' ||
      this.state === 'swapping'
    ) {
      throw new Error('A rebuild is already in progress')
    }
    this.log = []
    this.bundlePath = null
    this.cancelled = false
    this.setState('running')
    this.job = jobRegistry.register({
      kind: 'app.rebuild',
      label: 'Rebuild & update',
      abort: () => this.cancel(),
    })

    try {
      await this.runPipeline()
      this.job?.finish('done')
      this.job = null
      this.setState('awaiting-confirm')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.job?.finish(this.cancelled ? 'cancelled' : 'error')
      this.job = null
      if (this.cancelled) {
        this.append('✗ Cancelled')
        this.setState('idle')
      } else {
        this.append(`✗ ${message}`)
        this.setState('error')
        logger.error('Rebuild failed', message)
      }
    }
  }

  private async runPipeline(): Promise<void> {
    const repo = repoRoot()

    this.append('◇ Preflight — checking source checkout…')
    if (!existsSync(join(repo, '.git'))) {
      throw new Error(`Not a git repository: ${repo}`)
    }
    const status = await this.capture('git', ['status', '--porcelain'], repo)
    if (isWorkingTreeDirty(status)) {
      throw new Error(
        'Source checkout has uncommitted changes — commit or stash them first, then retry.',
      )
    }

    this.append('◇ Switching to prod branch (main) and pulling…')
    await this.run('git', ['checkout', 'main'], repo)
    await this.run('git', ['pull', '--ff-only'], repo)

    this.append('◇ Installing dependencies…')
    await this.run('pnpm', ['install', '--frozen-lockfile'], repo)

    this.append('◇ Building app (pnpm dist) — this takes a few minutes…')
    await this.run('pnpm', ['dist'], repo)

    this.append('◇ Locating freshly built app…')
    const releaseDir = join(repo, 'release')
    const entries = existsSync(releaseDir) ? readdirSync(releaseDir) : []
    const staged = pickStagedBundle(releaseDir, entries)
    if (!staged || !existsSync(staged)) {
      throw new Error('Build finished but no staged .app was found under release/.')
    }
    this.bundlePath = staged
    this.append(`✓ Build ready: ${staged}`)
  }

  // Spawn a child in the repo with the login-shell PATH, streaming stdout+stderr
  // into the log line-by-line. Rejects on non-zero exit (or when cancelled).
  private run(cmd: string, args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.append(`$ ${cmd} ${args.join(' ')}`)
      let child: ChildProcess
      try {
        child = spawn(cmd, args, {
          cwd,
          env: { ...process.env, PATH: enrichedPath() },
        })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      this.child = child

      let outRest = ''
      let errRest = ''
      const pump = (chunk: Buffer, restRef: 'out' | 'err'): void => {
        const prev = restRef === 'out' ? outRest : errRest
        const { lines, rest } = splitLines(prev, chunk.toString())
        if (restRef === 'out') outRest = rest
        else errRest = rest
        for (const line of lines) this.append(line)
      }
      child.stdout?.on('data', (c: Buffer) => pump(c, 'out'))
      child.stderr?.on('data', (c: Buffer) => pump(c, 'err'))

      child.on('error', (err) => {
        this.child = null
        reject(err)
      })
      child.on('close', (code) => {
        this.child = null
        if (outRest) this.append(outRest)
        if (errRest) this.append(errRest)
        if (this.cancelled) {
          reject(new Error('cancelled'))
          return
        }
        if (code === 0) resolve()
        else reject(new Error(`${cmd} ${args[0] ?? ''} exited with code ${code}`))
      })
    })
  }

  // Like run(), but resolves the collected stdout (used for `git status`).
  private capture(cmd: string, args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try {
        child = spawn(cmd, args, { cwd, env: { ...process.env, PATH: enrichedPath() } })
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
        return
      }
      this.child = child
      let out = ''
      child.stdout?.on('data', (c: Buffer) => {
        out += c.toString()
      })
      child.on('error', (err) => {
        this.child = null
        reject(err)
      })
      child.on('close', (code) => {
        this.child = null
        if (this.cancelled) {
          reject(new Error('cancelled'))
          return
        }
        if (code === 0) resolve(out)
        else reject(new Error(`${cmd} ${args[0] ?? ''} exited with code ${code}`))
      })
    })
  }

  // Only meaningful mid-build; kills the child and lets the pipeline reject.
  cancel(): void {
    if (this.state !== 'running') return
    this.cancelled = true
    if (this.child) {
      try {
        this.child.kill('SIGTERM')
      } catch {
        // already gone
      }
    }
  }

  // Write the detached relaunch script, spawn it so it outlives us, then quit.
  confirmSwap(): void {
    if (this.state !== 'awaiting-confirm' || !this.bundlePath) {
      throw new Error('No build is ready to install')
    }
    const target = resolveTargetBundle(process.execPath)
    const scriptPath = swapScriptPath(app.getPath('userData'))
    const script = swapScript({ oldPid: process.pid, staged: this.bundlePath, target })
    writeFileSync(scriptPath, script, { mode: 0o755 })

    this.append(`◇ Replacing ${target} and relaunching…`)
    this.setState('swapping')

    const child = spawn('/bin/sh', [scriptPath], { detached: true, stdio: 'ignore' })
    child.unref()
    logger.info('Rebuild swap spawned; quitting to relaunch', { target, staged: this.bundlePath })

    // Let the detached child get scheduled before we tear the process down.
    setTimeout(() => app.quit(), 250)
  }
}

export const rebuildRun = new RebuildRun()
