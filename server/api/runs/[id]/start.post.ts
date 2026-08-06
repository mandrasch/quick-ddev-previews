import { startEnv } from '../../../daemon/run-controls'

// POST /api/runs/:id/start: bring a stopped run's environment back up (the
// kept volumes and checkout boot in seconds). The preview comes back online.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  await startEnv(id)
  return { ok: true }
})
