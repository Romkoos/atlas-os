import {
  clearDevBinding,
  createRoadmapItem,
  getDevBinding,
  listRoadmap,
  removeRoadmapItem,
  setDevBinding,
  updateRoadmapItem,
} from '@main/services/roadmap/store'
import { recordSignal } from '@main/services/signals/registry'
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
    .mutation(({ input }) => {
      const item = createRoadmapItem(input)
      recordSignal({
        source: 'roadmap',
        type: 'roadmap.card_added',
        severity: 'info',
        title: `New idea: ${item.title}`,
        detail: item.category,
        link: 'roadmap',
        linkKind: 'section',
      })
      return item
    }),

  update: publicProcedure
    .input(roadmapUpdateSchema)
    .output(roadmapItemSchema)
    .mutation(({ input }) => {
      const item = updateRoadmapItem(input)
      // Only a status transition is signal-worthy (drag/edit of other fields is
      // noise). `input.status` is present only when the caller changed it.
      if (input.status) {
        recordSignal({
          source: 'roadmap',
          type: 'roadmap.status_changed',
          severity: input.status === 'done' ? 'success' : 'info',
          title: `${item.title} → ${input.status}`,
          detail: null,
          link: 'roadmap',
          linkKind: 'section',
        })
      }
      return item
    }),

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
