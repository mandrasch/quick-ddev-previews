import { retryRun } from '../../../daemon/run-controls'

// POST /api/runs/:id/retry: re-queue a finished run for a fresh boot (Retry
// button on the run page and list). 409 while the run is still active.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  retryRun(id)
  return { ok: true }
})
