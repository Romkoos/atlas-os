import { checkUpdates, listPlugins, setEnabled, updatePlugin } from '@main/services/plugins/cli'
import { publicProcedure, router } from '@main/trpc/trpc'
import { pluginSchema, updateInfoSchema, updateResultSchema } from '@shared/plugins'
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
  checkUpdates: publicProcedure.output(z.array(updateInfoSchema)).mutation(() => checkUpdates()),

  update: publicProcedure
    .input(idInput)
    .output(updateResultSchema)
    .mutation(({ input }) => updatePlugin(input.id)),
})
