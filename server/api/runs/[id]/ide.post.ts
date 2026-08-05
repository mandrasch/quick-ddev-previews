import { IDE_LABEL, previewHostname, previewKey } from '../../../../shared/utils/preview-host'
import { requireRun } from '../../../utils/entities'
import { ideMountMissing, ideStaged, startRunIde } from '../../../daemon/ide'
import { rebootRun } from '../../../daemon/run-controls'

// POST /api/runs/:id/ide → make sure the run's web IDE is up and return its
// origin (`ide--<slug>.preview.<host>`). The client opens it in a new tab; auth
// happens at the IDE origin itself (utils/ide-proxy.ts, same session cookie).
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })
  const run = requireRun(id)
  if (run.envState !== 'up') {
    throw createError({ statusCode: 409, statusMessage: 'Boot or reboot the environment first.' })
  }

  // Envs booted before the IDE existed (or before its download finished) lack
  // the mount. Heal in place: rebootRun refreshes the compose override and
  // `ddev start` reconciles the container. Not while the run is booting:
  // recreating the web container would kill it.
  if (ideStaged() && await ideMountMissing(id)) {
    if (run.status === 'queued' || run.status === 'running') {
      throw createError({
        statusCode: 409,
        statusMessage: 'The environment needs a quick restart to add the IDE. Wait for the current run to finish, then try again.',
      })
    }
    await rebootRun(id)
  }

  await startRunIde(id)

  const url = getRequestURL(event)
  return { url: `${url.protocol}//${previewHostname(previewKey(run), url.host, IDE_LABEL)}` }
})
