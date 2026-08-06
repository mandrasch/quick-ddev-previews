import { rebootRun } from '../../../daemon/run-controls'

// POST /api/runs/:id/reboot: restart the run's environment. Re-applies the
// current ddev override (so a .env editor change takes effect) and reconciles
// the stack. The preview blips, then comes back.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  await rebootRun(id)
  return { ok: true }
})
