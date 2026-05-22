import { appPaths } from '@main/paths'
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
  return { ...requireStore().store }
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
