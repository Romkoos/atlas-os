import { _electron as electron, expect, test } from '@playwright/test'

// E2E infrastructure + one boot smoke test. Run with `pnpm build` then `pnpm e2e`.
// More flows (run agent, settings persistence) are added later — see README TODO.
test('app boots and renders the sidebar', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByText('Atlas OS')).toBeVisible()
  await app.close()
})
