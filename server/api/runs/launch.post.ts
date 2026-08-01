import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { projects, runs } from '../../db/schema'
import { dispatchRuns } from '../../daemon/runner'

// POST /api/runs/launch: create (or reuse) the project row from the picked
// repo, then queue a run for it. The dispatcher picks it up and boots the
// preview. Body carries everything the launch form collected.
const envVarSchema = z.object({ key: z.string().min(1), value: z.string() })

const body = z.object({
  repo: z.object({
    githubId: z.number(),
    owner: z.string(),
    name: z.string(),
    fullName: z.string(),
    defaultBranch: z.string(),
    private: z.boolean(),
    cloneUrl: z.string(),
  }),
  branch: z.string().optional(),
  startCommand: z.string().optional(),
  envVars: z.array(envVarSchema).default([]),
})

export default defineEventHandler(async (event) => {
  const parsed = body.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message || 'Invalid request' })
  }

  const { repo, branch, startCommand, envVars } = parsed.data

  // Upsert the project row.
  const existing = db.select().from(projects).where(eq(projects.githubId, repo.githubId)).get()
  const project = existing
    ?? db.insert(projects)
      .values({
        githubId: repo.githubId,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        defaultBranch: repo.defaultBranch,
        private: repo.private,
        cloneUrl: repo.cloneUrl,
      })
      .returning()
      .get()

  // Queue the run.
  const run = db.insert(runs)
    .values({
      projectId: project.id,
      branch: branch || repo.defaultBranch,
      startCommand: startCommand || null,
      envVars,
    })
    .returning()
    .get()

  // Poke the dispatcher for an instant start.
  void dispatchRuns()

  return { runId: run.id, projectId: project.id }
})
