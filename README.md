# Atlas OS

A macOS desktop control panel for AI tools. Electron shell, React renderer, typed
IPC, local SQLite. Ships with one full vertical slice: **Run agent → stream a Claude
response → save to a `.md` file + SQLite → show it live**, plus Stats and Settings.

This is a starter built to grow: agent chat, a skills library, more providers, and
richer analytics all sit on the same spine.

---

## Stack

| Layer | Tech |
|------|------|
| Shell / build | Electron 38 · electron-vite · electron-builder · @electron/rebuild |
| Renderer | React 19 + TypeScript (strict) · Tailwind v4 · shadcn/ui · Zustand · TanStack Query · Recharts · React Hook Form + Zod · sonner · lucide-react |
| IPC | electron-trpc + tRPC v11 (every procedure has a Zod input/output) |
| Main | better-sqlite3 · Drizzle ORM + drizzle-kit · electron-store (encrypted) · electron-log · @anthropic-ai/sdk · electron-updater |
| Tooling | pnpm · Biome · Vitest · Playwright · Volta · simple-git-hooks |

> **Why Electron 38, not the latest?** `better-sqlite3` (a native module) does not yet
> compile against the V8 shipped in Electron 39+. Electron is pinned to `~38.8.6` until
> upstream catches up — see TODO.

---

## Architecture

The renderer has **no Node.js access**. Every domain operation (DB, files, the Claude
SDK) runs in main and is reached over a typed tRPC bridge. The renderer never makes
HTTP calls — all network happens in main.

```
┌───────────────────────────┐         ┌────────────────────────────────────────┐
│        Renderer            │         │                Main                      │
│  (React, sandboxed webview)│         │           (Node, backend)                │
│                            │         │                                          │
│  Dashboard / Stats /       │         │  tRPC routers (Zod in/out):              │
│  Settings                  │         │   health · settings · agent · stats      │
│        │                   │         │        │            │          │         │
│        │ trpc react hooks  │         │        ▼            ▼          ▼         │
│        ▼                   │         │  electron-store   better-sqlite3   files  │
│   ipcLink ───────────────► │ IPC     │   (encrypted)     + Drizzle      (.md)   │
│        ◄────────────────── │ electron│        │            │                    │
│   subscription (tokens)    │  -trpc  │        ▼            ▼                    │
│                            │         │   @anthropic-ai/sdk (messages.stream)    │
│  preload: contextBridge    │         │        │                                 │
│  (contextIsolation, sandbox│         │        ▼                                 │
│   nodeIntegration:false)   │         │   api.anthropic.com (HTTPS, main only)   │
└───────────────────────────┘         └────────────────────────────────────────┘
```

Streaming uses a tRPC **subscription**: main calls the SDK with streaming on and
emits token/done/error events; the renderer appends tokens as they arrive.

---

## Prerequisites

- **[Volta](https://volta.sh)** — pins Node and pnpm automatically from `package.json`
  (`node 22.22.1`, `pnpm 9.15.0`). With Volta installed, `cd` into the repo and the
  right versions are used. Without Volta, install Node 22.x and pnpm 9.x manually
  (`.nvmrc` + `engines` enforce the range; `engine-strict=true`).
- **pnpm** — `npm i -g pnpm` (or via Volta: `volta install pnpm`).
- **Xcode Command Line Tools** — required to compile `better-sqlite3`:
  `xcode-select --install`.

## Commands

```bash
pnpm install     # installs deps; postinstall rebuilds better-sqlite3 for Electron
pnpm dev         # Vite HMR + auto-restart main + opens the Electron window
pnpm build       # typecheck + production bundle into ./out
pnpm dist        # build + package a .dmg into ./release (installs on a clean Mac)

pnpm typecheck   # tsc (node + web projects)
pnpm lint        # Biome check
pnpm format      # Biome format --write
pnpm test        # Vitest unit tests
pnpm e2e         # Playwright (run after pnpm build)
pnpm db:generate # generate a Drizzle migration after editing the schema
```

A pre-commit hook (simple-git-hooks) runs `pnpm lint && pnpm typecheck`.

## First run

1. `pnpm install && pnpm dev`
2. Open **Settings** (or press <kbd>⌘</kbd><kbd>,</kbd>), paste your Anthropic API key,
   pick a model and output folder, **Save**.
3. On **Dashboard**, press **Run agent** — the response streams in, then a toast
   confirms the saved `.md` file (with **Open file**). **Stats** updates after runs.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| <kbd>⌘</kbd><kbd>,</kbd> | Open Settings |
| <kbd>⌘</kbd><kbd>R</kbd> | Reload window |
| <kbd>⌘</kbd><kbd>⇧</kbd><kbd>R</kbd> | Force reload |
| <kbd>⌘</kbd><kbd>⌥</kbd><kbd>I</kbd> | Toggle DevTools |

---

## Where things live (macOS)

| What | Path |
|------|------|
| SQLite database | `~/Library/Application Support/atlas-os/atlas.db` |
| Settings (encrypted) | `~/Library/Application Support/atlas-os/settings.json` |
| Generated `.md` output (default) | `~/Library/Application Support/atlas-os/outputs/` |
| Logs (rotating, 5 MB) | `~/Library/Logs/atlas-os/main.log` |

> The output folder is configurable in Settings. The API key is stored in the
> encrypted settings file and is **never** written to the database or the logs.

---

## Security

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes only the electron-trpc channel and a tiny `window.atlas` bridge.
- Strict Content-Security-Policy in production (relaxed in dev for Vite HMR).
- API key encrypted at rest via electron-store (obfuscation, not hardware-backed —
  see TODO: Keychain).

---

## Troubleshooting

**`better-sqlite3` fails to load / ABI mismatch**
Rebuild it against Electron's ABI:
```bash
pnpm rebuild better-sqlite3        # or:
pnpm exec electron-rebuild -f -w better-sqlite3
```
If it fails to *compile*, confirm Xcode CLT is installed and that Electron is on the
`38.x` line (39+ is not yet supported by better-sqlite3).

**Reset all app data** (DB, settings, caches):
```bash
rm -rf "$HOME/Library/Application Support/atlas-os" "$HOME/Library/Logs/atlas-os"
```

**Check the database / migrations:**
```bash
sqlite3 "$HOME/Library/Application Support/atlas-os/atlas.db" ".tables"
sqlite3 "$HOME/Library/Application Support/atlas-os/atlas.db" "SELECT * FROM __drizzle_migrations;"
```
Migrations run automatically on startup. After editing `src/main/db/schema.ts`, run
`pnpm db:generate` to create a new migration in `./drizzle`.

**Unsigned app warning on launch** (expected — not notarized): right-click the app →
Open, or `xattr -dr com.apple.quarantine "/Applications/Atlas OS.app"`.

---

## TODO (next steps)

- [ ] Apple Developer ID code signing
- [ ] Notarization (`@electron/notarize`)
- [ ] Activate auto-update: set up release publishing (`electron-builder.yml` →
      `publish`) and call `autoUpdater.checkForUpdatesAndNotify()`
- [ ] Move the API key to the macOS **Keychain** (`keytar` / `safeStorage`)
- [ ] App icon + DMG background
- [ ] MCP servers
- [ ] Skills library
- [ ] Agent chat UI
- [ ] Additional providers (OpenAI, Google, …)
- [ ] Bump Electron past 38 once `better-sqlite3` supports the newer V8
