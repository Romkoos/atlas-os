import { listSkills, readSkill, readSkillRaw, writeSkill } from '@main/services/skills'
import { publicProcedure, router } from '@main/trpc/trpc'
import { skillDetailSchema, skillMetaSchema } from '@shared/skills'
import { z } from 'zod'

export const skillsRouter = router({
  list: publicProcedure.output(z.array(skillMetaSchema)).query(() => listSkills()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(skillDetailSchema)
    .query(({ input }) => readSkill(input.id)),

  getRaw: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ content: z.string() }))
    .query(async ({ input }) => ({ content: await readSkillRaw(input.id) })),

  save: publicProcedure
    .input(z.object({ id: z.string(), content: z.string() }))
    .output(z.object({ ok: z.literal(true) }))
    .mutation(async ({ input }) => {
      await writeSkill(input.id, input.content)
      return { ok: true as const }
    }),
})
