import { _electron as electron, expect, test } from '@playwright/test'

// E2E infrastructure + smoke tests. Run with `pnpm build` then `pnpm e2e`.
test('boots, renders, and round-trips tRPC over IPC', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  // Renderer mounted.
  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  // query IPC: the sidebar auth badge resolves to the online indicator.
  await expect(window.getByText('● ok')).toBeVisible({ timeout: 15000 })

  // query IPC: opening Settings renders the form from settings.get.
  await window.getByRole('button', { name: '10 SETTINGS' }).click()
  await expect(window.getByText('default model')).toBeVisible()

  await app.close()
})

test('Maps page shows the graphify code graph with a single Build control', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()
  await window.getByRole('button', { name: '04 MAPS' }).click()

  // CodeGraphTab renders directly on the Maps page, but its controls are only
  // present when graph projects exist; skip cleanly otherwise.
  const buildBtn = window.getByRole('button', { name: 'Build', exact: true })
  await buildBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  if (await buildBtn.isVisible().catch(() => false)) {
    // The two separate controls (structural Build mutation + "Deep map via
    // graphify" subscription) have been collapsed into a single full-cycle
    // Build button driven by trpc.graph.build.
    await expect(buildBtn).toBeVisible()
    await expect(window.getByRole('button', { name: 'Deep map via graphify' })).toHaveCount(0)

    // six source toggles, sessions off by default
    for (const label of ['code', 'doc', 'session', 'knowledge', 'skill', 'graphify']) {
      await expect(window.getByRole('checkbox', { name: label })).toBeVisible()
    }
    await expect(window.getByRole('checkbox', { name: 'session' })).not.toBeChecked()
  }

  await app.close()
})

test('Roadmap page renders seeded items', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  await window.getByRole('button', { name: '02 ROADMAP' }).click()

  // A seeded item + its category heading render (proves list.query round-trips).
  await expect(window.getByText('Agent Orchestrator (multi-agent workflows)')).toBeVisible({
    timeout: 15000,
  })
  await expect(window.getByRole('button', { name: /new idea/i })).toBeVisible()

  await app.close()
})

test('Roadmap Board view shows status columns', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  await window.getByRole('button', { name: '02 ROADMAP' }).click()
  await window.getByRole('button', { name: 'Board', exact: true }).click()

  // The four status column headers render STATUS_LABELS DOM text (CSS
  // uppercases them visually); exact match avoids colliding with "hide done".
  await expect(window.getByText('To do', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(window.getByText('Planned', { exact: true })).toBeVisible()
  await expect(window.getByText('In progress', { exact: true })).toBeVisible()
  await expect(window.getByText('Done', { exact: true })).toBeVisible()

  // At least one seeded card renders on the board (guards against an
  // empty-columns regression).
  await expect(window.getByText('Agent Orchestrator (multi-agent workflows)')).toBeVisible()

  await app.close()
})

test('Roadmap "new idea" opens the incubator chat', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  await window.getByRole('button', { name: '02 ROADMAP' }).click()
  await window.getByRole('button', { name: /new idea/i }).click()

  // "new idea" opens the unified chat drawer on a roadmap "idea incubator"
  // session, at its idea-entry step (no agent call yet).
  await expect(window.getByRole('button', { name: /start brainstorming/i })).toBeVisible()

  // End the session via the tab's close (×); the incubator step disappears.
  await window.getByRole('button', { name: 'Close idea incubator' }).click()
  await expect(window.getByRole('button', { name: /start brainstorming/i })).toHaveCount(0)

  await app.close()
})

test('restores last section + tab after reload', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  // Navigate to News and select the GitHub Trending feed tab.
  await window.getByRole('button', { name: '05 NEWS' }).click()
  await window.getByRole('button', { name: /GITHUB TRENDING/ }).click()
  await expect(window.getByRole('button', { name: /GITHUB TRENDING/ })).toHaveClass(/on/)

  // Reload the renderer; persisted ui store should reopen News on the trending tab.
  await window.reload()
  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()
  await expect(window.getByRole('button', { name: /GITHUB TRENDING/ })).toHaveClass(/on/, {
    timeout: 15000,
  })

  await app.close()
})

test('top bar shows the process indicator at idle', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()

  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  // The JobIndicator subscribes to jobs.list and settles to idle when nothing
  // is running — proves the subscription round-trips over IPC.
  await expect(window.getByText('● idle')).toBeVisible({ timeout: 15000 })

  await app.close()
})

test('FAB type picker opens a worker chat', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  // With no active chats, the FAB opens a two-icon picker (Chat vs Worker).
  await window.getByRole('button', { name: 'Open chat' }).click()
  await expect(window.getByRole('button', { name: 'Worker' })).toBeVisible()

  // Opening Worker mounts the full-access worker overlay at its intro step.
  await window.getByRole('button', { name: 'Worker' }).click()
  await expect(window.getByRole('button', { name: /start worker/i })).toBeVisible()

  // End the session via the tab's close (×); the intro disappears.
  await window.getByRole('button', { name: 'Close worker' }).click()
  await expect(window.getByRole('button', { name: /start worker/i })).toHaveCount(0)

  await app.close()
})

test('Dashboard shows the processes panel', async () => {
  const app = await electron.launch({ args: ['.'] })
  const window = await app.firstWindow()
  await expect(window.getByRole('heading', { name: 'ATLAS.OS' })).toBeVisible()

  await window.getByRole('button', { name: '01 DASHBOARD' }).click()

  // Panel title + the deterministic idle state of the chip strip render.
  await expect(window.getByText('processes', { exact: true })).toBeVisible({ timeout: 15000 })
  await expect(window.getByText('// all systems idle')).toBeVisible()

  await app.close()
})
