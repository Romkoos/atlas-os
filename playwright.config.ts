import { defineConfig } from '@playwright/test'

// E2E infrastructure only. Real Electron tests are added later (see TODO in README).
// Drives the built app via Playwright's _electron API.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: 'list',
})
