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

test('restores last section + tab after reload', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByText('ATLAS.OS')).toBeVisible()

  // Navigate to News and select the GitHub Trending feed tab.
  await window.getByRole('button', { name: '05 NEWS' }).click()
  await window.getByRole('button', { name: /GITHUB TRENDING/ }).click()
  await expect(window.getByRole('button', { name: /GITHUB TRENDING/ })).toHaveClass(/on/)

  // Reload the renderer; persisted ui store should reopen News on the trending tab.
  await window.reload()
  await expect(window.getByText('ATLAS.OS')).toBeVisible()
  await expect(window.getByRole('button', { name: /GITHUB TRENDING/ })).toHaveClass(/on/, {
    timeout: 15000,
  })

  await app.close()
})

test('Productivity benchmark tab hides the days range selector', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByText('ATLAS.OS')).toBeVisible()

  await window.getByRole('button', { name: '03 PRODUCTIVITY' }).click()

  // On overview, the 30d range button is present.
  await expect(window.getByRole('button', { name: '30d', exact: true })).toBeVisible({
    timeout: 15000,
  })

  // Switch to benchmark: the days range buttons are removed.
  await window.getByRole('button', { name: './benchmark' }).click()
  await expect(window.getByRole('button', { name: '30d', exact: true })).toHaveCount(0)

  await app.close()
})

test('top bar shows the process indicator at idle', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await expect(window.getByText('ATLAS.OS')).toBeVisible()

  // The JobIndicator subscribes to jobs.list and settles to idle when nothing
  // is running — proves the subscription round-trips over IPC.
  await expect(window.getByText('● idle')).toBeVisible({ timeout: 15000 })

  await app.close()
})
