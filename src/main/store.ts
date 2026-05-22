import { appPaths } from '@main/paths'
import type { AppSettings } from '@shared/settings'
import { DEFAULT_SETTINGS } from '@shared/settings'
import Store from 'electron-store'

// NOTE: electron-store's encryptionKey is obfuscation, not real security — the
// key ships inside the app. See README TODO: migrate the API key to macOS Keychain.
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

export function getApiKey(): string {
  return requireStore().get('apiKey')
}
