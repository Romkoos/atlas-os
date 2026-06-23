import { _electron as electron, expect, test } from '@playwright/test'

// E2E infrastructure + smoke tests. Run with `pnpm build` then `pnpm e2e`.
test('boots, renders, and round-trips tRPC over IPC', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  // Renderer mounted.
  await expect(window.getByText('ATLAS.OS')).toBeVisible()

  // query IPC: the sidebar auth badge resolves to the online indicator.
  await expect(window.getByText('● ok')).toBeVisible({ timeout: 15000 })

  // query IPC: opening Settings renders the form from settings.get.
  await window.getByRole('button', { name: '09 SETTINGS' }).click()
  await expect(window.getByText('default model')).toBeVisible()

  await app.close()
})

test('Knowledge graph tab renders a canvas', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await expect(window.getByText('ATLAS.OS')).toBeVisible()
  await window.getByRole('button', { name: '04 KNOWLEDGE' }).click()

  // The graph tab is only present when projects exist; skip cleanly otherwise.
  const graphTab = window.getByRole('button', { name: './graph' })
  await graphTab.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await graphTab.isVisible().catch(() => false)) {
    await graphTab.click()
    const canvas = window.locator('.kb-graph canvas')
    await expect(canvas).toBeVisible({ timeout: 15000 })

    // The canvas must fill its .kb-graph container, not stay at a fixed size.
    const containerBox = await window.locator('.kb-graph').boundingBox()
    const canvasBox = await canvas.boundingBox()
    expect(containerBox).not.toBeNull()
    expect(canvasBox).not.toBeNull()
    if (containerBox && canvasBox) {
      // Within the 1px border on each side.
      expect(Math.abs(canvasBox.width - containerBox.width)).toBeLessThan(8)
      expect(Math.abs(canvasBox.height - containerBox.height)).toBeLessThan(8)
    }
  }

  await app.close()
})
