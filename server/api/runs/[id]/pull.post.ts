import { pullRun } from '../../../daemon/run-controls'
import { requireRun } from '../../../utils/entities'

// POST /api/runs/:id/pull: pull the branch's latest commits into the existing
// checkout and re-apply them to the running env. Returns immediately; the work
// runs in the background (server/daemon/run-controls.ts) and streams progress
// to the run's boot log. Poll run.pulling for completion.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  const run = requireRun(id)
  if (run.envState !== 'up' && run.envState !== 'stopped') {
    throw createError({ statusCode: 409, statusMessage: 'The environment has not been booted yet' })
  }
  void pullRun(id)
  return { ok: true }
})
