import { _electron as electron, expect, test } from '@playwright/test'

// E2E infrastructure + smoke tests. Run with `pnpm build` then `pnpm e2e`.
// More flows (run agent, settings persistence) are added later — see README TODO.
test('boots, renders the sidebar, and loads Settings over tRPC', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  // Renderer mounted.
  await expect(window.getByText('Atlas OS')).toBeVisible()

  // tRPC IPC round-trip: opening Settings renders the form from settings.get.
  await window.getByRole('button', { name: 'Settings' }).click()
  await expect(window.getByText('Anthropic API key')).toBeVisible()

  await app.close()
})
