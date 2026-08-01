import { eq, desc } from 'drizzle-orm'
import { db } from '../../db'
import { projects, runs } from '../../db/schema'

// GET /api/runs: recent runs, newest first. Joins the project for the repo
// name. The log blob is omitted from the list (fetched per-run).
export default defineEventHandler(async () => {
  const rows = db.select({
    id: runs.id,
    projectId: runs.projectId,
    fullName: projects.fullName,
    owner: projects.owner,
    name: projects.name,
    branch: runs.branch,
    status: runs.status,
    envState: runs.envState,
    previewReady: runs.previewReady,
    previewHosts: runs.previewHosts,
    startedAt: runs.startedAt,
    finishedAt: runs.finishedAt,
    createdAt: runs.createdAt,
  })
    .from(runs)
    .innerJoin(projects, eq(projects.id, runs.projectId))
    .orderBy(desc(runs.createdAt))
    .limit(100)
    .all()

  return rows
})
