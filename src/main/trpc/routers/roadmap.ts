import {
  clearDevBinding,
  createRoadmapItem,
  getDevBinding,
  listRoadmap,
  removeRoadmapItem,
  setDevBinding,
  updateRoadmapItem,
} from '@main/services/roadmap/store'
import { publicProcedure, router } from '@main/trpc/trpc'
import {
  devBindingSchema,
  roadmapCreateSchema,
  roadmapItemSchema,
  roadmapUpdateSchema,
} from '@shared/roadmap'
import { clipboard } from 'electron'
import { z } from 'zod'

export const roadmapRouter = router({
  list: publicProcedure.output(z.array(roadmapItemSchema)).query(() => listRoadmap()),

  create: publicProcedure
    .input(roadmapCreateSchema)
    .output(roadmapItemSchema)
    .mutation(({ input }) => createRoadmapItem(input)),

  update: publicProcedure
    .input(roadmapUpdateSchema)
    .output(roadmapItemSchema)
    .mutation(({ input }) => updateRoadmapItem(input)),

  remove: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      removeRoadmapItem(input.id)
      return { ok: true }
    }),

  getDevBinding: publicProcedure.output(devBindingSchema.nullable()).query(() => getDevBinding()),

  setDevBinding: publicProcedure
    .input(devBindingSchema)
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      setDevBinding(input)
      return { ok: true }
    }),

  clearDevBinding: publicProcedure.output(z.object({ ok: z.boolean() })).mutation(() => {
    clearDevBinding()
    return { ok: true }
  }),

  // The sandboxed renderer's navigator.clipboard is unreliable; write from main.
  copyText: publicProcedure
    .input(z.object({ text: z.string() }))
    .output(z.object({ ok: z.boolean() }))
    .mutation(({ input }) => {
      clipboard.writeText(input.text)
      return { ok: true }
    }),
})
