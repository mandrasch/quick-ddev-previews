import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../../db'
import { runs } from '../../../db/schema'
import { requireRun } from '../../../utils/entities'
import { unmaskEnvVars } from '../../../utils/env-mask'

// PATCH /api/runs/:id/env: edit the run's env vars ANYTIME, not just at launch
// (the .env editor on the run page). The GET returns values masked with a
// sentinel (server/utils/env-mask.ts); a sentinel value here means "keep the
// stored value", so secrets never round-trip through the UI as plaintext. The
// new values take effect on the next env reboot.
const envVarSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Invalid environment key'),
  value: z.string(),
})

const body = z.object({ envVars: z.array(envVarSchema) })

export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  const run = requireRun(id)

  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid request' })
  }

  const keys = parsed.data.envVars.map(e => e.key)
  if (new Set(keys).size !== keys.length) {
    throw createError({ statusCode: 400, statusMessage: 'Environment keys must be unique' })
  }

  const merged = unmaskEnvVars((run.envVars ?? []) as { key: string, value: string }[], parsed.data.envVars)
  db.update(runs).set({ envVars: merged }).where(eq(runs.id, id)).run()
  return { ok: true }
})
