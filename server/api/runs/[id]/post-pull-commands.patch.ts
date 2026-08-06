import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { runs } from '../../../db/schema'
import { requireRun } from '../../../utils/entities'

// PATCH /api/runs/:id/post-pull-commands: edit the commands run AFTER a git
// pull (the "Post-pull commands" editor on the run page). Each line is one
// shell command, executed in order in the web container after the run's start
// command. Blank lines and surrounding whitespace are dropped.
const body = z.object({
  commands: z.array(z.string()),
})

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  requireRun(id)

  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid request' })
  }

  const commands = parsed.data.commands
    .map(c => c.trim())
    .filter(Boolean)

  db.update(runs).set({ postPullCommands: commands }).where(eq(runs.id, id)).run()
  return { ok: true }
})
