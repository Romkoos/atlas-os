import { jobRegistry, trackJob } from '@main/services/jobs/registry'
import {
  addMarketplace,
  browseMarketplace,
  checkUpdates,
  installPlugin,
  listPlugins,
  mcpHealth,
  pluginDetails,
  setEnabled,
  uninstallPlugin,
  updatePlugin,
} from '@main/services/plugins/cli'
import { publicProcedure, router } from '@main/trpc/trpc'
import {
  marketplacePluginSchema,
  mcpHealthSchema,
  opResultSchema,
  pluginDetailsSchema,
  pluginSchema,
  updateInfoSchema,
  updateResultSchema,
} from '@shared/plugins'
import { z } from 'zod'

const idInput = z.object({ id: z.string().min(1) })

export const pluginsRouter = router({
  list: publicProcedure.output(z.array(pluginSchema)).query(() => listPlugins()),

  setEnabled: publicProcedure
    .input(idInput.extend({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await setEnabled(input.id, input.enabled)
      return { ok: true }
    }),

  // Network I/O (refreshes marketplaces) — gated behind an explicit user action.
  checkUpdates: publicProcedure
    .output(z.array(updateInfoSchema))
    .mutation(() =>
      trackJob(
        jobRegistry,
        { kind: 'plugins', label: 'Plugin update check', detail: 'all marketplaces' },
        checkUpdates(),
      ),
    ),

  update: publicProcedure
    .input(idInput)
    .output(updateResultSchema)
    .mutation(({ input }) =>
      trackJob(
        jobRegistry,
        { kind: 'plugins', label: 'Plugin update', detail: input.id },
        updatePlugin(input.id),
      ),
    ),

  // ---- marketplace ---------------------------------------------------------

  // Catalog of plugins advertised by configured marketplaces (disk read, fast).
  browse: publicProcedure.output(z.array(marketplacePluginSchema)).query(() => browseMarketplace()),

  // Lazy per-card component inventory + token cost.
  details: publicProcedure
    .input(idInput)
    .output(pluginDetailsSchema)
    .query(({ input }) => pluginDetails(input.id)),

  install: publicProcedure
    .input(idInput)
    .output(opResultSchema)
    .mutation(({ input }) =>
      trackJob(
        jobRegistry,
        { kind: 'plugins', label: 'Plugin install', detail: input.id },
        installPlugin(input.id),
      ),
    ),

  uninstall: publicProcedure
    .input(idInput)
    .output(opResultSchema)
    .mutation(({ input }) =>
      trackJob(
        jobRegistry,
        { kind: 'plugins', label: 'Plugin uninstall', detail: input.id },
        uninstallPlugin(input.id),
      ),
    ),

  addMarketplace: publicProcedure
    .input(z.object({ source: z.string().min(1) }))
    .output(opResultSchema)
    .mutation(({ input }) =>
      trackJob(
        jobRegistry,
        { kind: 'plugins', label: 'Marketplace add', detail: input.source },
        addMarketplace(input.source),
      ),
    ),

  // ---- health --------------------------------------------------------------

  // Ping every configured MCP server (network) and report status.
  mcpHealth: publicProcedure
    .output(z.array(mcpHealthSchema))
    .mutation(() =>
      trackJob(
        jobRegistry,
        { kind: 'plugins', label: 'MCP health check', detail: 'all servers' },
        mcpHealth(),
      ),
    ),
})
