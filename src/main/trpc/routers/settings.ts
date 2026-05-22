import { setLogLevel } from '@main/logger'
import { getSettings, resetSettings, setSettings } from '@main/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import { settingsSchema } from '@shared/settings'
import { BrowserWindow, dialog } from 'electron'
import { z } from 'zod'

export const settingsRouter = router({
  get: publicProcedure.output(settingsSchema).query(() => getSettings()),

  set: publicProcedure
    .input(settingsSchema.partial())
    .output(settingsSchema)
    .mutation(({ input }) => {
      const next = setSettings(input)
      if (input.logLevel) setLogLevel(input.logLevel)
      return next
    }),

  reset: publicProcedure.output(settingsSchema).mutation(() => {
    const next = resetSettings()
    setLogLevel(next.logLevel)
    return next
  }),

  chooseDirectory: publicProcedure
    .output(z.object({ canceled: z.boolean(), path: z.string().nullable() }))
    .mutation(async () => {
      const win = BrowserWindow.getFocusedWindow()
      const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'createDirectory'],
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      const path = result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
      return { canceled: result.canceled, path }
    }),
})
