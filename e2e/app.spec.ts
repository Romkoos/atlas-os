import { _electron as electron, expect, test } from '@playwright/test'

// E2E infrastructure + smoke tests. Run with `pnpm build` then `pnpm e2e`.
test('boots, renders, and round-trips tRPC over IPC', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  // Renderer mounted.
  await expect(window.getByText('Atlas OS')).toBeVisible()

  // query IPC: the health badge resolves to "Backend OK".
  await expect(window.getByText(/Backend OK/)).toBeVisible({ timeout: 15000 })

  // query IPC: opening Settings renders the form from settings.get.
  await window.getByRole('button', { name: 'Settings' }).click()
  await expect(window.getByText('Default model')).toBeVisible()

  await app.close()
})
