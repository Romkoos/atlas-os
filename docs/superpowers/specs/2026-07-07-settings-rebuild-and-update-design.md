# Settings "Rebuild & Update" — self-rebuild from prod branch

**Date:** 2026-07-07
**Status:** Design (approved)
**Area:** Settings · Main process · Packaging/deploy

## Problem

Shipping a new build today is a manual terminal ritual (the deploy protocol):
`pnpm dist` → quit the running app → `ditto`-replace `/Applications/Atlas OS.app`
→ relaunch. We want a one-button version of the *build+swap+relaunch* half of
that, launched from inside the app — and it must work **from the packaged prod
app**, not just from `pnpm dev`.

## Decisions (from brainstorming)

1. **Git strategy — ensure `main`, fail if dirty.** If the source checkout's
   working tree is dirty, abort with a clear error (never touch in-progress
   work). Otherwise `git checkout main && git pull --ff-only`, then build.
2. **Progress UX — live streaming log.** A modal streams stdout+stderr of every
   step in real time.
3. **Confirm before the destructive swap.** Build runs first; a
   "Build succeeded — replace app & relaunch now?" confirmation gates the
   quit+swap.
4. **Swap survives the quit via a detached shell script** (approach A). The app
   cannot replace/relaunch its own bundle while running, so main writes a tiny
   `.sh`, spawns it `detached + unref`, then `app.quit()`. The script waits for
   the old PID to die, `ditto`-replaces the bundle, and `open`s it.
5. **Surfaces as a job** (`app.rebuild`) in the global process indicator/tray.

## Key facts the design leans on

- The packaged app has **no repo inside the bundle**. `repoRoot()` (paths.ts)
  already resolves to the source checkout `/Users/.../atlas-os` when packaged.
- Spawned children need the **login-shell PATH** (`enrichedPath()`) so `git`,
  `pnpm`, `node` resolve under launchd's minimal PATH.
- `pnpm dist` **signs** with the self-signed "Atlas OS Local" identity, so the
  one-time Full Disk Access / TCC grant survives the swap (stable designated
  requirement). No extra signing work needed here.
- electron-builder (`electron-builder.yml`, `directories.output: release`)
  **stages the `.app` before the dmg** at `release/mac*/Atlas OS.app`, so the
  swap copies that staged bundle directly — no dmg mounting.

## Architecture

### 1. Main service — `src/main/services/rebuild/` (singleton `rebuildRun`)

A single global run decoupled from any subscription (registry style, but far
lighter than the chat registry — no persistence, no resume, no reattach seq).

State machine: `idle → running → awaiting-confirm → swapping` with a terminal
`error`. Holds a **capped log-line ring buffer** and an `EventEmitter`. Public
API:

- `start()` — rejects if a run is already active; otherwise runs the pipeline.
- `confirmSwap()` — only valid in `awaiting-confirm`; writes+spawns the detached
  swap script, then `app.quit()`.
- `cancel()` — kills the current child, sets `error`/`idle`.
- `snapshot()` — `{ state, log[], bundlePath? }` for reattach.
- `on('event', cb)` — live `{ state, line? }` events.

**Pipeline** (each step spawned in `repoRoot()`, `env.PATH = enrichedPath()`,
stdout+stderr streamed line-by-line into the buffer + emitter):

1. **Preflight** — assert `repoRoot()` is a git work tree; `git status
   --porcelain` must be empty. Non-empty → error "working tree dirty…", abort.
2. `git checkout main` → `git pull --ff-only`.
3. `pnpm install --frozen-lockfile` (runs the `electron-rebuild` postinstall,
   same as a terminal build).
4. `pnpm dist`.
5. Resolve the staged bundle via glob `release/mac*/Atlas OS.app`; assert it
   exists. → state `awaiting-confirm`, record `bundlePath`.

Registered in `jobRegistry` as kind `app.rebuild` (label "Rebuild & update")
for the duration, cancellable via `cancel()`.

### 2. Swap handoff (`confirmSwap`)

- **Target bundle** = the currently-running `.app` (walk up from
  `process.execPath` until a `*.app` dir; fall back to `/Applications/Atlas
  OS.app` in dev where there is no bundle).
- Write `swap-and-relaunch.sh` to `userData`, `chmod +x`, spawn with
  `detached: true, stdio: 'ignore'`, `child.unref()`. Then `app.quit()`.
- Script body (pure-string builder, unit-tested):
  ```sh
  while kill -0 <OLD_PID> 2>/dev/null; do sleep 0.3; done
  rm -rf "<TARGET>"
  ditto "<STAGED>" "<TARGET>"
  open "<TARGET>"
  ```
  Paths are shell-quoted. `<OLD_PID>` = `process.pid`.

### 3. tRPC router — `src/main/trpc/routers/rebuild.ts`

- `status` query → `{ state, log, bundlePath }` (reattach).
- `stream` subscription → `observable` that **replays the buffer** then forwards
  live emitter events; teardown only removes the listener (never cancels the
  run). Mirrors the decoupled registry pattern, not news.run's teardown-cancels.
- `start`, `confirmSwap`, `cancel` mutations.

Registered in `router.ts` as `rebuild`.

### 4. Shared types — `src/shared/rebuild.ts`

`RebuildState` union, `RebuildEvent` (`{ state, line? }`), `RebuildSnapshot`.

### 5. Renderer

- **Button:** a new panel pinned at the **top** of `Settings.tsx` (above the
  AUTH banner) with a `⟳ REBUILD & UPDATE` button + one-line explainer.
- **Store:** `store/rebuildRun.ts` (zustand) — `open` flag + mirrored
  `{ state, log }`, fed by the subscription.
- **Host:** `RebuildRunHost` mounted at App level (like `NewsRunHost`) so the
  stream + job survive tab switches.
- **Modal:** streaming `<pre>` log (monospace, auto-scroll). Footer is
  state-driven: `running` → Cancel; `awaiting-confirm` → "Replace app &
  relaunch now?" (→ `confirmSwap`) + Cancel; `error` → message + Close.
- **Reattach:** on mount, if `status.state !== 'idle'`, open the modal and
  resume streaming.

## Testing

- **Unit (vitest):** dirty-tree parsing (`git status --porcelain` → boolean);
  staged-bundle glob resolution; running-bundle resolution from a fake
  execPath; swap-script string generation (quoting, PID, paths). Keep these in
  Electron-free helper modules (like `shellPath.ts`) so no `app` mock is needed.
- **Live:** verify end-to-end in `pnpm dev` first (build streams, confirm,
  swap+relaunch of `/Applications/Atlas OS.app`), per the "verify in dev before
  packaging" rule — then package and confirm it works from the prod app.

## Out of scope / YAGNI

- No auto-update feed / electron-updater wiring.
- No branch picker (always prod `main`).
- No persistence/resume of an in-flight rebuild across an app restart (a rebuild
  is short-lived and user-initiated).
