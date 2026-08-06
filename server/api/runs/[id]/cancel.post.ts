import { cancelRunRequest } from '../../../daemon/run-controls'

// POST /api/runs/:id/cancel: cancel an in-flight run (Cancel button). Aborts a
// 'running' boot via the runner; a still-queued run just flips to 'cancelled'.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  cancelRunRequest(id)
  return { ok: true }
})
