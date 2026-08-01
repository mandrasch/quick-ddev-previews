import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { runs } from '../../db/schema'
import { cancelRun } from '../../daemon/runner'
import { removeEnvStack } from '../../daemon/sandbox'

// DELETE /api/runs/:id: cancel an in-flight run (if any), tear down its ddev
// environment (containers + volumes), and delete the row.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })

  const run = db.select().from(runs).where(eq(runs.id, id)).get()
  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })

  // Cancel an in-flight run first (best-effort; it may already be done).
  cancelRun(id)

  // Tear down the environment. Best-effort: a never-booted run has nothing.
  try {
    await removeEnvStack(id)
  }
  catch {
    // Best-effort teardown.
  }

  db.delete(runs).where(eq(runs.id, id)).run()
  return { ok: true }
})
