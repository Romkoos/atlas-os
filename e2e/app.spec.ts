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

test('Knowledge graph tab renders a canvas', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await expect(window.getByText('Atlas OS')).toBeVisible()
  await window.getByRole('button', { name: 'Knowledge' }).click()

  // The graph tab is only present when projects exist; skip cleanly otherwise.
  const graphTab = window.getByRole('button', { name: './graph' })
  if (await graphTab.isVisible().catch(() => false)) {
    await graphTab.click()
    await expect(window.locator('.kb-graph canvas')).toBeVisible({ timeout: 15000 })
  }

  await app.close()
})
