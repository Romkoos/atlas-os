import { _electron as electron, expect, test } from '@playwright/test'

// Reproduction harness for the reported CodeGraph crash:
//   "Cannot read properties of undefined (reading 'tick')"
// thrown from inside react-force-graph-3d's requestAnimationFrame loop when the
// graph mounts after navigating in from another page. The throw is async (rAF),
// so it surfaces as a window 'pageerror', NOT a React error the boundary catches.

async function graphScenario(reload: boolean) {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  window.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)))
  window.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })

  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  // Land somewhere else first, so entering the graph is a fresh mount from
  // another page — the reported trigger.
  await window.getByRole('button', { name: '01 DASHBOARD' }).click()
  await expect(window.getByText('processes', { exact: true })).toBeVisible({ timeout: 15000 })

  await window.getByRole('button', { name: '04 MAPS' }).click()

  // CodeGraphTab renders directly on the Maps page. Its canvas is only present
  // when a graph has been built; skip cleanly otherwise.
  const canvas = window.locator('.kb-graph canvas')
  await canvas.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
  if (!(await canvas.first().isVisible().catch(() => false))) {
    await app.close()
    return { skipped: true, pageErrors, consoleErrors }
  }

  // Stress the reheat path: bounce off another page and back a few times — each
  // remount re-runs the deferred reheat.
  for (let i = 0; i < 3; i++) {
    await window.getByRole('button', { name: '01 DASHBOARD' }).click()
    await window.waitForTimeout(200)
    await window.getByRole('button', { name: '04 MAPS' }).click()
    await window.waitForTimeout(600)
  }

  if (reload) {
    await window.reload()
    await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()
    await window.waitForTimeout(1500)
  }

  await window.waitForTimeout(1000)
  await app.close()
  return { skipped: false, pageErrors, consoleErrors }
}

test('entering CodeGraph from another page does not throw the rAF tick error', async () => {
  const { skipped, pageErrors, consoleErrors } = await graphScenario(false)
  if (skipped) test.skip(true, 'no built graph on this machine')
  const tickErr = [...pageErrors, ...consoleErrors].filter((m) => /reading 'tick'|\.tick\b/.test(m))
  expect(tickErr, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
})

test('toggling to the 2D view and re-entering does not throw the rAF tick error', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  const pageErrors: string[] = []
  window.on('pageerror', (e) => pageErrors.push(String(e.message ?? e)))

  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()
  await window.getByRole('button', { name: '04 MAPS' }).click()

  // CodeGraphTab renders directly on the Maps page; its canvas is only present
  // when a graph has been built.
  const canvas = window.locator('.kb-graph canvas')
  await canvas.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  if (!(await canvas.first().isVisible().catch(() => false))) {
    await app.close()
    test.skip(true, 'no built graph on this machine')
    return
  }

  // Switch to 2D, then bounce off another page and back several times so the
  // 2D ForceGraph remounts fresh each time and re-runs its reheat.
  const twoD = window.getByRole('button', { name: '2D', exact: true })
  await twoD.click().catch(() => {})
  for (let i = 0; i < 3; i++) {
    await window.getByRole('button', { name: '01 DASHBOARD' }).click()
    await window.waitForTimeout(200)
    await window.getByRole('button', { name: '04 MAPS' }).click()
    await twoD.click().catch(() => {})
    await window.waitForTimeout(600)
  }

  await window.waitForTimeout(1000)
  await app.close()
  const tickErr = pageErrors.filter((m) => /reading 'tick'|\.tick\b/.test(m))
  expect(tickErr, `page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
