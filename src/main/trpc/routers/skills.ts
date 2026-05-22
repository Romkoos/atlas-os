import { listSkills, readSkill } from '@main/services/skills'
import { publicProcedure, router } from '@main/trpc/trpc'
import { skillDetailSchema, skillMetaSchema } from '@shared/skills'
import { z } from 'zod'

export const skillsRouter = router({
  list: publicProcedure.output(z.array(skillMetaSchema)).query(() => listSkills()),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(skillDetailSchema)
    .query(({ input }) => readSkill(input.id)),
})
