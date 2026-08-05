import { eq, sql } from 'drizzle-orm'
import { db } from '../../db'
import { projects, runs } from '../../db/schema'
import { isPulling } from '../../daemon/run-controls'

// GET /api/runs/:id: a single run WITH its log, for the detail page poll.
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(id)) throw createError({ statusCode: 400, statusMessage: 'Invalid run id' })

  const run = db.select({
    id: runs.id,
    projectId: runs.projectId,
    fullName: projects.fullName,
    owner: projects.owner,
    name: projects.name,
    branch: runs.branch,
    slug: runs.slug,
    visibility: runs.visibility,
    previewPasswordSet: sql<boolean>`${runs.previewPasswordHash} is not null`,
    startCommand: runs.startCommand,
    envVars: runs.envVars,
    postPullCommands: runs.postPullCommands,
    status: runs.status,
    envState: runs.envState,
    previewReady: runs.previewReady,
    previewHosts: runs.previewHosts,
    previewLastSeen: runs.previewLastSeen,
    log: runs.log,
    startedAt: runs.startedAt,
    finishedAt: runs.finishedAt,
    createdAt: runs.createdAt,
  })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .where(eq(runs.id, id))
    .get()

  if (!run) throw createError({ statusCode: 404, statusMessage: 'Run not found' })
  return {
    ...run,
    // A git pull is currently re-applying the branch in the background; the
    // run page polls it to keep its "Pulling…" state and log live.
    pulling: isPulling(id),
  }
})
