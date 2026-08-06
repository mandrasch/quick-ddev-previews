import { checkRunPullStatus } from '../../../daemon/run-controls'

// GET /api/runs/:id/pull-status: is the run's branch ahead of the checkout?
// Powers the "behind / up to date" hint next to the Pull button.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  return await checkRunPullStatus(id)
})
