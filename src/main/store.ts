import { appPaths } from '@main/paths'
import { DEFAULT_MODEL_ID, isClaudeModelId } from '@shared/models'
import type { AppSettings } from '@shared/settings'
import { DEFAULT_SETTINGS } from '@shared/settings'
import Store from 'electron-store'

// Settings hold no secrets (auth is the Claude subscription, not an API key).
// encryptionKey is light obfuscation of the on-disk JSON, not real security.
const ENCRYPTION_KEY = 'atlas-os-local-store-v1'

let store: Store<AppSettings> | null = null

export function initStore(): void {
  const { defaultOutputDir } = appPaths()
  store = new Store<AppSettings>({
    name: 'settings',
    encryptionKey: ENCRYPTION_KEY,
    clearInvalidConfig: true,
    defaults: { ...DEFAULT_SETTINGS, outputDir: defaultOutputDir },
  })
}

function requireStore(): Store<AppSettings> {
  if (!store) throw new Error('Settings store not initialized')
  return store
}

export function getSettings(): AppSettings {
  const settings = { ...requireStore().store }
  // A model persisted by an older build (e.g. a since-removed model id) is no
  // longer a valid choice — coerce it to the current default so the SDK and the
  // Settings selector never operate on a dangling id.
  if (!isClaudeModelId(settings.model)) settings.model = DEFAULT_MODEL_ID
  return settings
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  requireStore().set(patch)
  return getSettings()
}

export function resetSettings(): AppSettings {
  // clear() restores the defaults registered in initStore().
  requireStore().clear()
  return getSettings()
}
