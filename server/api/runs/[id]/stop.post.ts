import { stopRun } from '../../../daemon/run-controls'

// POST /api/runs/:id/stop: stop the run's environment (containers removed,
// volumes and checkout kept). The preview goes offline until Start.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  await stopRun(id)
  return { ok: true }
})
